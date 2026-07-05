import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdminUser } from '@/lib/auth/server';
import { createInterventionCold } from '@/app/admin/interventions/actions';
import { safeTypeIntervention } from '@/lib/mails/intervention-types';
import {
  COLONNES_IMPORT,
  appairerOccupants,
  brusselsOffset,
  creneauDebutIso,
  mapStatutFichier,
  normalise,
  normaliseNomAcp,
  parseDateImport,
  parseHeureImport,
  resoudreAliasSyndic,
  type LigneImport,
} from '@/lib/import/encodage-froid';
import type {
  CreateFromSlotSyndic,
  CreateFromSlotParticulier,
  SlotOccupant,
} from '@/app/admin/planning/actions';

export const dynamic = 'force-dynamic';
// Jusqu'à 20 lignes par appel : ~3 SELECT + 1 création + 1 UPDATE par ligne.
export const maxDuration = 60;

// POST /api/admin/import/encodage-froid
// Body : { rows: LigneImport[], dryRun: boolean }
//
// Import en masse d'interventions historiques (encodage à froid). Chaque
// ligne passe par la MÊME logique métier que le bouton « Créer une
// intervention » (createInterventionCold — silencieux : ni Drive, ni agenda,
// ni notification).
//
// RÈGLE GLOBALE : les référentiels (ACP, syndics) existent déjà en base.
// L'import ne crée JAMAIS ni ACP ni organisation — résolution seule,
// introuvable/ambigu = rejet de la ligne. Seul enrichissement autorisé :
// organisations.bce si NULL en base et présent dans le fichier (jamais
// d'écrasement, jamais en dryRun).
//
// dryRun=true : validation + résolutions + checks doublons — AUCUNE écriture.

const MAX_ROWS_PER_CALL = 50;

interface ResultatLigne {
  row: number;
  status: 'ok' | 'doublon' | 'rejet';
  ref?: string;
  raison?: string;
  details?: string;
}

interface SyndicRow { id: string; nom: string; bce: string | null }
interface AcpRow { id: string; nom: string; adresse: string | null; syndic_id_ref: string | null }

// ─── Résolutions référentiels (lecture seule, matching normalisé) ───────────

type Resolution<T> =
  | { ok: true; item: T; exact: boolean }
  | { ok: false; raison: string };

function resoudreSyndic(nomFichier: string, syndics: SyndicRow[]): Resolution<SyndicRow> {
  const cible = normalise(resoudreAliasSyndic(nomFichier));
  const exacts = syndics.filter((s) => normalise(s.nom) === cible);
  if (exacts.length === 1) return { ok: true, item: exacts[0], exact: true };
  if (exacts.length > 1) {
    return { ok: false, raison: `syndic ambigu : ${nomFichier} (${exacts.map((s) => s.nom).join(', ')})` };
  }
  const partiels = syndics.filter((s) => {
    const n = normalise(s.nom);
    return n.includes(cible) || cible.includes(n);
  });
  if (partiels.length === 1) return { ok: true, item: partiels[0], exact: false };
  if (partiels.length > 1) {
    return { ok: false, raison: `syndic ambigu : ${nomFichier} (${partiels.map((s) => s.nom).join(', ')})` };
  }
  return { ok: false, raison: `syndic introuvable : ${nomFichier}` };
}

function resoudreAcp(nomFichier: string, acps: AcpRow[]): Resolution<AcpRow> {
  const cible = normaliseNomAcp(nomFichier);
  const exacts = acps.filter((a) => normaliseNomAcp(a.nom) === cible);
  if (exacts.length === 1) return { ok: true, item: exacts[0], exact: true };
  if (exacts.length > 1) {
    return { ok: false, raison: `ACP ambiguë : ${nomFichier} (${exacts.map((a) => a.nom).join(', ')})` };
  }
  const partiels = acps.filter((a) => {
    const n = normaliseNomAcp(a.nom);
    return n.includes(cible) || cible.includes(n);
  });
  if (partiels.length === 1) return { ok: true, item: partiels[0], exact: false };
  if (partiels.length > 1) {
    return { ok: false, raison: `ACP ambiguë : ${nomFichier} (${partiels.map((a) => a.nom).join(', ')})` };
  }
  return { ok: false, raison: `ACP introuvable : ${nomFichier}` };
}

// ─── Demandeur particulier minimal (aucun syndic résolvable) ────────────────

// Adresse belge « Rue X 12, 1000 Bruxelles » → { cp, ville } best-effort.
function extraireCpVille(adresse: string): { cp: string; ville: string } {
  const m = adresse.match(/\b(\d{4})\s+([^,;]+?)\s*$/);
  return { cp: m?.[1] ?? '0000', ville: (m?.[2] ?? '—').trim() };
}

function demandeurParticulierMinimal(l: LigneImport, acp: AcpRow | null): CreateFromSlotParticulier {
  const rue = l.adresse.trim() || acp?.adresse?.trim() || '—';
  const { cp, ville } = extraireCpVille(rue);
  return {
    demandeur_type: 'particulier',
    mandant: {
      prenom: 'Import',
      nom: acp?.nom || l.acp.trim() || 'Historique',
      // Placeholder : le fichier ne porte pas d'email mandant et
      // createInterventionCold l'exige. Adresse interne, jamais notifiée
      // (création à froid = silencieuse).
      email: 'import-historique@foxo.be',
      tel: '',
      adresse_facturation: { rue, code_postal: cp, ville },
    },
    lieu: { meme_que_mandant: true, rue, cp, ville },
    contact_sur_place: { actif: false },
  };
}

// ─── Corps de la ligne ──────────────────────────────────────────────────────

function sanitizeRow(raw: unknown): LigneImport | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const row = typeof r.row === 'number' && Number.isFinite(r.row) ? r.row : 0;
  const out = { row } as LigneImport;
  for (const c of COLONNES_IMPORT) {
    out[c.field] = typeof r[c.field] === 'string' ? (r[c.field] as string) : '';
  }
  return out;
}

export async function POST(request: Request) {
  // 1. Auth (client cookie) — admin uniquement. Même garde que les autres
  //    routes /api/admin/* (cf. occupants/manage/*/confirm).
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await isAdminUser())) {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as
    | { rows?: unknown; dryRun?: unknown }
    | null;
  const rawRows = Array.isArray(body?.rows) ? body.rows : null;
  if (!rawRows || rawRows.length === 0) {
    return NextResponse.json({ ok: false, error: 'rows[] requis.' }, { status: 400 });
  }
  if (rawRows.length > MAX_ROWS_PER_CALL) {
    return NextResponse.json(
      { ok: false, error: `Maximum ${MAX_ROWS_PER_CALL} lignes par appel (envoi par chunks côté client).` },
      { status: 400 },
    );
  }
  const dryRun = body?.dryRun !== false; // défaut = dry-run (sécurité)
  const rows = rawRows.map(sanitizeRow).filter((r): r is LigneImport => r !== null);

  const admin = createAdminClient();

  // 2. Référentiels chargés UNE fois par appel (tables petites).
  const [synRes, acpRes] = await Promise.all([
    admin.from('organisations').select('id, nom, bce').eq('type', 'syndic'),
    admin.from('acps').select('id, nom, adresse, syndic_id_ref'),
  ]);
  if (synRes.error) {
    return NextResponse.json({ ok: false, error: `Lecture syndics : ${synRes.error.message}` }, { status: 500 });
  }
  if (acpRes.error) {
    return NextResponse.json({ ok: false, error: `Lecture ACP : ${acpRes.error.message}` }, { status: 500 });
  }
  const syndics = (synRes.data ?? []) as SyndicRow[];
  const acps = (acpRes.data ?? []) as AcpRow[];

  // 3. Traitement séquentiel (l'idempotence intra-fichier repose sur le fait
  //    que la ligne N voit les insertions des lignes < N).
  const results: ResultatLigne[] = [];
  for (const l of rows) {
    try {
      results.push(await traiterLigne(l));
    } catch (e) {
      results.push({
        row: l.row,
        status: 'rejet',
        ref: l.ref_foxo.trim() || undefined,
        raison: `erreur interne : ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  return NextResponse.json({ ok: true, results });

  // ─── Une ligne, dans l'ordre imposé par le chantier ───────────────────────
  async function traiterLigne(l: LigneImport): Promise<ResultatLigne> {
    const notes: string[] = [];
    const refFoxo = l.ref_foxo.trim();
    const rejet = (raison: string): ResultatLigne => ({
      row: l.row, status: 'rejet', ref: refFoxo || undefined, raison,
    });

    // 1. VALIDATION — statut, date, heure.
    const st = mapStatutFichier(l.statut);
    if (!st.ok) return rejet(st.raison);
    const date = parseDateImport(l.date);
    if (!date) return rejet(`date illisible « ${l.date.trim() || '—'} » (attendu AAAA-MM-JJ)`);
    const heure = parseHeureImport(l.heure);
    if (heure === null) return rejet(`heure illisible « ${l.heure.trim() } » (attendu HH:MM ou vide)`);
    const creneauDebut = creneauDebutIso(date, heure);

    // 2. IDEMPOTENCE — ref FoxO, sinon (jour + adresse).
    if (refFoxo) {
      const { data, error } = await admin
        .from('interventions')
        .select('id')
        .eq('ref', refFoxo)
        .is('deleted_at', null)
        .limit(1);
      if (error) throw new Error(`check doublon ref : ${error.message}`);
      if ((data ?? []).length > 0) {
        return { row: l.row, status: 'doublon', ref: refFoxo, raison: 'référence déjà en base' };
      }
    } else if (l.adresse.trim()) {
      const off = brusselsOffset(date);
      const { data, error } = await admin
        .from('interventions')
        .select('id, ref')
        .gte('creneau_debut', `${date}T00:00:00${off}`)
        .lte('creneau_debut', `${date}T23:59:59${off}`)
        .ilike('adresse', l.adresse.trim())
        .is('deleted_at', null)
        .limit(1);
      if (error) throw new Error(`check doublon jour+adresse : ${error.message}`);
      const found = (data ?? []) as { id: string; ref: string | null }[];
      if (found.length > 0) {
        return {
          row: l.row, status: 'doublon',
          raison: `même jour + même adresse (ref ${found[0].ref ?? found[0].id})`,
        };
      }
    }

    // 3. SYNDIC — résolution seule (alias en config). JAMAIS de création.
    let syndic: SyndicRow | null = null;
    if (l.syndic.trim()) {
      const res = resoudreSyndic(l.syndic.trim(), syndics);
      if (!res.ok) return rejet(res.raison);
      syndic = res.item;
      if (!res.exact) notes.push(`syndic « ${l.syndic.trim()} » → ${syndic.nom}`);
      // Enrichissement UNIQUE autorisé : BCE si NULL en base (jamais en dryRun).
      const bce = l.bce.trim();
      if (bce && !syndic.bce) {
        if (dryRun) {
          notes.push(`BCE ${bce} à compléter sur la fiche syndic`);
        } else {
          const { error } = await admin.from('organisations').update({ bce }).eq('id', syndic.id);
          if (error) notes.push(`BCE non écrit : ${error.message}`);
          else { syndic.bce = bce; notes.push(`BCE ${bce} complété sur la fiche syndic`); }
        }
      }
    }

    // 4. ACP — résolution seule (matching tolérant). JAMAIS de création.
    let acp: AcpRow | null = null;
    if (l.acp.trim()) {
      const res = resoudreAcp(l.acp.trim(), acps);
      if (!res.ok) return rejet(res.raison);
      acp = res.item;
      if (!res.exact) notes.push(`ACP « ${l.acp.trim()} » → ${acp.nom}`);
    } else if (syndic) {
      // Un syndic sans ACP ne peut pas passer par la branche syndic de
      // createInterventionCold (acp_id requis) : donnée à corriger.
      return rejet('ACP manquante (requise quand un syndic est renseigné)');
    }

    // Syndic hérité de l'ACP si absent de la ligne.
    if (!syndic && acp?.syndic_id_ref) {
      syndic = syndics.find((s) => s.id === acp!.syndic_id_ref) ?? null;
      if (syndic) notes.push(`syndic hérité de l'ACP : ${syndic.nom}`);
    }

    // 5. DEMANDEUR + OCCUPANTS.
    const demandeur: CreateFromSlotSyndic | CreateFromSlotParticulier =
      acp && syndic
        ? { demandeur_type: 'syndic', acp_id: acp.id, syndic_id: syndic.id, occupants: [] }
        : demandeurParticulierMinimal(l, acp);
    if (demandeur.demandeur_type === 'particulier') {
      notes.push('demandeur particulier minimal (aucun syndic résolu)');
    }

    const conf = st.occupantsConfirmes ? ('confirme' as const) : ('en_attente' as const);
    const occupants: SlotOccupant[] = appairerOccupants(l.occupants, l.telephones, l.appartements)
      .map((o) => ({
        appartement: o.appartement,
        prenom: '',
        nom: o.nom,
        email: '',
        telephone: o.telephone,
        conf,
      }));

    const typeSafe = safeTypeIntervention(l.type.trim() || null);
    if (normalise(typeSafe) !== normalise(l.type.trim()) ) {
      notes.push(`type « ${l.type.trim() || '—'} » → ${typeSafe}`);
    }

    // 7. DRY-RUN : tout est validé/résolu, AUCUNE écriture.
    if (dryRun) {
      return {
        row: l.row, status: 'ok',
        ref: refFoxo || '(auto)',
        details: notes.join(' · ') || undefined,
      };
    }

    // 5 (suite). CRÉATION — même logique métier que le bouton admin.
    const res = await createInterventionCold({
      ref: refFoxo || undefined,
      statut: st.statut,
      type: typeSafe,
      priorite: 'normale',
      adresse: l.adresse.trim() || undefined,
      reference_externe: l.ref_syndic.trim() || undefined,
      creneau_debut: creneauDebut,
      technicien_id: null,
      demandeur,
      occupants,
    });
    if (!res.ok) return rejet(`création : ${res.error}`);
    const { intervention_id, ref } = res.data!;

    // 6. COMPLÉMENT post-création (assureur / lien rapport Drive).
    const complement: Record<string, unknown> = {};
    const refSinistre = l.ref_sinistre.trim();
    const assureurNom = l.assureur.trim();
    if (refSinistre || assureurNom) {
      // Structure conforme à Intervention['assureur'] (lib/types/database.ts).
      complement.assureur = {
        assure: null,
        nom: assureurNom || null,
        email: null,
        telephone: null,
        reference_sinistre: refSinistre || null,
        reference_police: null,
      };
    }
    const rapportDrive = l.rapport_drive.trim();
    if (rapportDrive) {
      // createInterventionCold a créé la ligne SANS description : on pose le
      // lien historique (append trivial — description était null).
      complement.description = `Rapport historique (Drive) : ${rapportDrive}`;
    }
    if (Object.keys(complement).length > 0) {
      const { error } = await admin
        .from('interventions')
        .update({ ...complement, updated_at: new Date().toISOString() })
        .eq('id', intervention_id);
      if (error) notes.push(`complément non écrit : ${error.message}`);
    }

    return { row: l.row, status: 'ok', ref, details: notes.join(' · ') || undefined };
  }
}
