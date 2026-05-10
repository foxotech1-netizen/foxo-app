// proposeCreneau — sélection d'un créneau libre optimal pour une nouvelle
// intervention, en se basant sur :
//   1. Une fenêtre temporelle (urgence vs normal, étendue si rien de libre)
//   2. La proximité géographique avec d'autres interventions du même jour
//      (groupage tournée → dist <2km = +500, <5km = +200, <10km = +100)
//   3. Un bonus de précocité (préférer le plus tôt à score égal)
//
// Lecture seule — n'effectue aucune mutation. Utilise le client admin
// Supabase (bypass RLS) car appelé depuis route serveur (cron / API admin).
//
// ⚠ Écarts vs spec d'origine signalés ici :
//   - intervention.date_rdv n'existe pas dans le schéma : on utilise
//     creneau_debut (timestamp) et on extrait la date côté code.
//   - statut 'en_cours' n'existe pas dans l'enum StatutIntervention : on
//     considère ('confirmee','realisee') comme "intervention planifiée
//     pour ce jour ou en train de se dérouler", non encore clôturée.

import { createAdminClient } from '@/lib/supabase/admin';

// ─── Types exportés ────────────────────────────────────────────────────

export interface CreneauPropose {
  creneau_id: string;
  date: string;                  // ISO YYYY-MM-DD
  heure_debut: string;
  heure_fin: string;
  technicien_id: string;
  technicien_nom: string;
  score: number;
}

export interface ProposeCreneauResult {
  primary: CreneauPropose | null;
  alternative: CreneauPropose | null;
  fenetre_etendue: boolean;
}

export interface ProposeCreneauParams {
  adresse_lat: number | null;
  adresse_lng: number | null;
  urgence: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────

const EARTH_RADIUS_KM = 6371;

export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

// Format ISO YYYY-MM-DD à partir d'une Date (UTC-safe : on prend les
// composants UTC pour éviter les drifts au passage à l'heure d'été).
function toIsoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

// Date+offset jours, retournée sous forme YYYY-MM-DD.
function isoDatePlusDays(base: Date, days: number): string {
  const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + days);
  return toIsoDate(d);
}

// Différence en jours entre 2 dates ISO YYYY-MM-DD (b - a, arrondi).
function daysBetween(aIso: string, bIso: string): number {
  const a = new Date(`${aIso}T00:00:00Z`).getTime();
  const b = new Date(`${bIso}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

// ─── Types internes (rows brutes Supabase) ────────────────────────────

interface CreneauRow {
  id: string;
  date: string;
  heure_debut: string;
  heure_fin: string;
  technicien_id: string | null;
  utilisateurs: { prenom: string | null; nom: string | null } | null;
}

interface InterventionRow {
  creneau_debut: string | null;
  lat: number | null;
  lng: number | null;
}

// ─── Cœur — fetch + scoring sur une fenêtre [debut, fin] ──────────────

async function findCreneauxInWindow(
  windowStartIso: string,
  windowEndIso: string,
  adresseLat: number | null,
  adresseLng: number | null,
  todayIso: string,
): Promise<CreneauPropose[]> {
  const admin = createAdminClient();

  // 1. Créneaux libres dans la fenêtre, joints au technicien pour le nom.
  //    On commande par date asc puis heure_debut asc → garantit que les
  //    créneaux les plus précoces dominent à score égal.
  const { data: creneauxRaw, error: errCre } = await admin
    .from('creneaux_disponibles')
    .select('id, date, heure_debut, heure_fin, technicien_id, utilisateurs:technicien_id (prenom, nom)')
    .eq('statut', 'libre')
    .gte('date', windowStartIso)
    .lte('date', windowEndIso)
    .order('date', { ascending: true })
    .order('heure_debut', { ascending: true });

  if (errCre) {
    console.warn('[proposeCreneau] fetch creneaux_disponibles error:', errCre.message);
    return [];
  }
  // Cast intermédiaire via unknown : Supabase inféré attend parfois la
  // jointure en array si la FK n'est pas marquée unique côté schema PostgREST.
  const creneaux = ((creneauxRaw ?? []) as unknown as CreneauRow[])
    .filter((c): c is CreneauRow & { technicien_id: string } => Boolean(c.technicien_id));

  if (creneaux.length === 0) return [];

  // 2. Charge les interventions actives (statut planifié/en terrain) dont
  //    le creneau_debut tombe dans la fenêtre. Une seule requête couvrant
  //    [windowStart, windowEnd+1d) — on regroupe par jour côté code.
  //    Filtrage géographique fait en mémoire (volume attendu modeste :
  //    ≤ 5 slots × ~5 techs × N jours).
  const ivLatLngByDate = new Map<string, Array<{ lat: number; lng: number }>>();
  if (adresseLat !== null && adresseLng !== null) {
    const rangeStart = `${windowStartIso}T00:00:00Z`;
    // Borne haute exclusive = jour suivant la fenêtre, à minuit.
    const rangeEndDate = new Date(`${windowEndIso}T00:00:00Z`);
    rangeEndDate.setUTCDate(rangeEndDate.getUTCDate() + 1);
    const rangeEnd = rangeEndDate.toISOString();

    const { data: ivRaw, error: errIv } = await admin
      .from('interventions')
      .select('creneau_debut, lat, lng')
      .in('statut', ['confirmee', 'realisee'])
      .not('lat', 'is', null)
      .not('lng', 'is', null)
      .not('creneau_debut', 'is', null)
      .gte('creneau_debut', rangeStart)
      .lt('creneau_debut', rangeEnd);

    if (errIv) {
      console.warn('[proposeCreneau] fetch interventions error:', errIv.message);
    } else {
      for (const iv of (ivRaw ?? []) as InterventionRow[]) {
        if (iv.creneau_debut === null || iv.lat === null || iv.lng === null) continue;
        const dayIso = iv.creneau_debut.slice(0, 10); // 'YYYY-MM-DD' du timestamp
        const arr = ivLatLngByDate.get(dayIso) ?? [];
        arr.push({ lat: iv.lat, lng: iv.lng });
        ivLatLngByDate.set(dayIso, arr);
      }
    }
  }

  // 3. Score chaque créneau.
  const scored: CreneauPropose[] = creneaux.map((c) => {
    let score = 0;

    if (adresseLat !== null && adresseLng !== null) {
      const sameDayIvs = ivLatLngByDate.get(c.date) ?? [];
      for (const iv of sameDayIvs) {
        const dist = haversineKm(adresseLat, adresseLng, iv.lat, iv.lng);
        if (dist < 2)       score += 500;
        else if (dist < 5)  score += 200;
        else if (dist < 10) score += 100;
      }
    }
    // Bonus précocité : (10 - jours_depuis_today). Peut être négatif si le
    // créneau est >10 jours dans le futur — c'est intentionnel (pénalise
    // les créneaux lointains à proximité géographique égale).
    score += 10 - daysBetween(todayIso, c.date);

    const prenom = c.utilisateurs?.prenom?.trim() ?? '';
    const nom = c.utilisateurs?.nom?.trim() ?? '';
    const technicienNom = [prenom, nom].filter(Boolean).join(' ').trim() || 'Technicien';

    return {
      creneau_id: c.id,
      date: c.date,
      heure_debut: c.heure_debut.slice(0, 5),
      heure_fin: c.heure_fin.slice(0, 5),
      technicien_id: c.technicien_id,
      technicien_nom: technicienNom,
      score,
    };
  });

  // 4. Tri : score DESC, puis date ASC pour départager (plus tôt = mieux).
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.heure_debut < b.heure_debut ? -1 : 1;
  });

  return scored;
}

// ─── API publique ─────────────────────────────────────────────────────

export async function proposeCreneau(
  params: ProposeCreneauParams,
): Promise<ProposeCreneauResult> {
  const today = new Date();
  const todayIso = isoDatePlusDays(today, 0);

  // Fenêtre primaire selon urgence.
  const primaryStartOffset = params.urgence ? 1 : 3;
  const primaryEndOffset   = params.urgence ? 3 : 10;
  const primaryStart = isoDatePlusDays(today, primaryStartOffset);
  const primaryEnd   = isoDatePlusDays(today, primaryEndOffset);

  let scored = await findCreneauxInWindow(
    primaryStart,
    primaryEnd,
    params.adresse_lat,
    params.adresse_lng,
    todayIso,
  );
  let fenetreEtendue = false;

  // Fallback : aucun créneau libre → étendre à today+10..today+20.
  if (scored.length === 0) {
    const extendedStart = isoDatePlusDays(today, 10);
    const extendedEnd   = isoDatePlusDays(today, 20);
    scored = await findCreneauxInWindow(
      extendedStart,
      extendedEnd,
      params.adresse_lat,
      params.adresse_lng,
      todayIso,
    );
    fenetreEtendue = true;
  }

  return {
    primary:     scored[0] ?? null,
    alternative: scored[1] ?? null,
    fenetre_etendue: fenetreEtendue,
  };
}
