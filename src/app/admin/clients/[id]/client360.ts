// Chargeur de données de la fiche client 360° (Mode Appel phase 2).
// Fonctions serveur uniquement (createAdminClient), AUCUN appel IA.
//
// Lien client → interventions (cf. audit 2026-07-31) :
//   - client ACP : interventions.acp_id = client.acp_id OU client_id = client.id
//     (acp_id est la colonne fiable partout, y compris les 151 dossiers importés) ;
//   - client particulier : interventions.client_id seul (les dossiers
//     particuliers créés à froid n'ont aucun id de lien — assumé hors périmètre).
//
// Impayé : règle canonique du module relances (type='facture', statut
// envoyee/en_retard, deleted_at IS NULL, date_echeance < aujourd'hui TZ
// Bruxelles) — réimplémentée ici car computeRelancesDues n'est pas filtrable
// par client.

import { createAdminClient } from '@/lib/supabase/admin';
import { splitHistoricReport } from '@/lib/rapport-historique';
import { STATUT_INFO, type StatutIntervention } from '@/lib/types/database';
import { TZ_BRUSSELS } from '@/lib/format';

const MAX_INTERVENTIONS = 100;

export interface Client360Intervention {
  id: string;
  ref: string | null;
  statut: StatutIntervention;
  type: string | null;
  adresse: string | null;
  creneau_debut: string | null;
  created_at: string;
  /** coalesce(creneau_debut, created_at) — date « métier » du dossier. */
  date_effective: string;
  rapport: { statut: string; transmis_at: string | null; date_rapport: string | null } | null;
  /** Lien Drive « Rapport historique » extrait de la description (dossiers importés). */
  rapport_historique_url: string | null;
  /** Description nettoyée (sans la ligne « Rapport historique (Drive) »). */
  description: string | null;
}

export interface Client360Facture {
  id: string;
  numero: string;
  date_emission: string | null;
  date_echeance: string | null;
  montant_ttc: number | null;
  statut: string;
  en_retard: boolean;
  jours_retard: number;
}

export interface Client360Occupant {
  nom: string | null;
  prenom: string | null;
  telephone: string | null;
  email: string | null;
  appartement: string | null;
  /** Réf. du dossier le plus récent où cet occupant apparaît. */
  intervention_ref: string | null;
  intervention_id: string;
}

export interface Client360 {
  interventions: Client360Intervention[];
  factures: Client360Facture[];
  occupants: Client360Occupant[];
  dernier_mail_at: string | null;
  impayes: { count: number; max_jours: number };
  resume: string;
}

// ─── Dates (TZ Bruxelles) ───────────────────────────────────────────────

function todayIsoBrussels(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ_BRUSSELS });
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.floor((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 86_400_000);
}

function fmtDateBe(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('fr-BE', {
      day: '2-digit', month: '2-digit', year: 'numeric', timeZone: TZ_BRUSSELS,
    });
  } catch {
    return iso;
  }
}

// ─── Chargeur ───────────────────────────────────────────────────────────

export async function getClient360(client: {
  id: string;
  acp_id: string | null;
  type: string | null;
}): Promise<Client360> {
  const admin = createAdminClient();
  const today = todayIsoBrussels();

  // a) interventions + c) factures — indépendantes, en parallèle.
  let ivQuery = admin
    .from('interventions')
    .select('id, ref, statut, type, adresse, creneau_debut, created_at, description')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(MAX_INTERVENTIONS);
  ivQuery = client.acp_id
    ? ivQuery.or(`acp_id.eq.${client.acp_id},client_id.eq.${client.id}`)
    : ivQuery.eq('client_id', client.id);

  const factQuery = admin
    .from('factures')
    .select('id, numero, date_emission, date_echeance, montant_ttc, statut')
    .eq('client_id', client.id)
    .eq('type', 'facture')
    .is('deleted_at', null)
    .order('date_emission', { ascending: false });

  const [ivRes, factRes] = await Promise.all([ivQuery, factQuery]);
  if (ivRes.error) throw new Error(`Interventions 360° : ${ivRes.error.message}`);
  if (factRes.error) throw new Error(`Factures 360° : ${factRes.error.message}`);

  type IvRow = {
    id: string; ref: string | null; statut: StatutIntervention; type: string | null;
    adresse: string | null; creneau_debut: string | null; created_at: string;
    description: string | null;
  };
  const ivRows = (ivRes.data ?? []) as IvRow[];
  const ids = ivRows.map((r) => r.id);

  // b) rapports, d) occupants, e) dernier mail — dépendent des ids.
  const [rapRes, occRes, mailRes, analyseRes] = ids.length > 0
    ? await Promise.all([
        admin
          .from('rapports')
          .select('intervention_id, statut, transmis_at, date_rapport')
          .in('intervention_id', ids),
        admin
          .from('occupants')
          .select('intervention_id, nom, prenom, telephone, email, appartement')
          .in('intervention_id', ids)
          .is('erased_at', null),
        admin
          .from('intervention_mails')
          .select('date')
          .in('intervention_id', ids)
          .not('date', 'is', null)
          .order('date', { ascending: false })
          .limit(1),
        admin
          .from('mails_analyses')
          .select('recu_le')
          .in('dossier_match_id', ids)
          .not('recu_le', 'is', null)
          .order('recu_le', { ascending: false })
          .limit(1),
      ])
    : [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }, { data: [], error: null }];

  // Best-effort sur les annexes : une table manquante ne casse pas la fiche.
  if (rapRes.error) console.warn('[client360] rapports:', rapRes.error.message);
  if (occRes.error) console.warn('[client360] occupants:', occRes.error.message);
  if (mailRes.error) console.warn('[client360] intervention_mails:', mailRes.error.message);
  if (analyseRes.error) console.warn('[client360] mails_analyses:', analyseRes.error.message);

  const rapportByIv = new Map(
    ((rapRes.data ?? []) as { intervention_id: string; statut: string; transmis_at: string | null; date_rapport: string | null }[])
      .map((r) => [r.intervention_id, { statut: r.statut, transmis_at: r.transmis_at, date_rapport: r.date_rapport }]),
  );

  // Tri métier : coalesce(creneau_debut, created_at) desc — en JS (pas de
  // coalesce dans l'order PostgREST).
  const interventions: Client360Intervention[] = ivRows
    .map((r) => {
      const { text, url } = splitHistoricReport(r.description);
      return {
        id: r.id,
        ref: r.ref,
        statut: r.statut,
        type: r.type,
        adresse: r.adresse,
        creneau_debut: r.creneau_debut,
        created_at: r.created_at,
        date_effective: r.creneau_debut ?? r.created_at,
        rapport: rapportByIv.get(r.id) ?? null,
        rapport_historique_url: url,
        description: text,
      };
    })
    .sort((a, b) => new Date(b.date_effective).getTime() - new Date(a.date_effective).getTime());

  // Factures + impayés (règle canonique, cf. en-tête).
  const factures: Client360Facture[] = ((factRes.data ?? []) as {
    id: string; numero: string; date_emission: string | null; date_echeance: string | null;
    montant_ttc: number | null; statut: string;
  }[]).map((f) => {
    const enRetard =
      (f.statut === 'envoyee' || f.statut === 'en_retard') &&
      !!f.date_echeance &&
      f.date_echeance < today;
    return {
      ...f,
      en_retard: enRetard,
      jours_retard: enRetard && f.date_echeance ? daysBetween(f.date_echeance, today) : 0,
    };
  });
  const enRetard = factures.filter((f) => f.en_retard);
  const impayes = {
    count: enRetard.length,
    max_jours: enRetard.reduce((m, f) => Math.max(m, f.jours_retard), 0),
  };

  // Occupants dédoublonnés par (nom + téléphone normalisés), rattachés au
  // dossier le plus récent où ils apparaissent (les interventions sont déjà
  // triées de la plus récente à la plus ancienne).
  const ivOrder = new Map(interventions.map((iv, idx) => [iv.id, idx]));
  const refById = new Map(interventions.map((iv) => [iv.id, iv.ref]));
  type OccRow = {
    intervention_id: string; nom: string | null; prenom: string | null;
    telephone: string | null; email: string | null; appartement: string | null;
  };
  const occRows = ((occRes.data ?? []) as OccRow[])
    .sort((a, b) => (ivOrder.get(a.intervention_id) ?? 1e9) - (ivOrder.get(b.intervention_id) ?? 1e9));
  const seen = new Set<string>();
  const occupants: Client360Occupant[] = [];
  for (const o of occRows) {
    const key = `${(o.nom ?? '').trim().toLowerCase()}|${(o.telephone ?? '').replace(/\D/g, '')}`;
    if (key === '|' || seen.has(key)) continue;
    seen.add(key);
    occupants.push({
      nom: o.nom,
      prenom: o.prenom,
      telephone: o.telephone,
      email: o.email,
      appartement: o.appartement,
      intervention_ref: refById.get(o.intervention_id) ?? null,
      intervention_id: o.intervention_id,
    });
  }

  // Dernier mail : MAX des deux sources (elles se complètent).
  const mailDate = ((mailRes.data ?? []) as { date: string | null }[])[0]?.date ?? null;
  const analyseDate = ((analyseRes.data ?? []) as { recu_le: string | null }[])[0]?.recu_le ?? null;
  const dernier_mail_at =
    mailDate && analyseDate
      ? (new Date(mailDate) >= new Date(analyseDate) ? mailDate : analyseDate)
      : mailDate ?? analyseDate;

  const resume = buildResumeSituation({ interventions, impayes, dernier_mail_at });

  return { interventions, factures, occupants, dernier_mail_at, impayes, resume };
}

// ─── Résumé de situation mécanique ──────────────────────────────────────

export function buildResumeSituation(data: {
  interventions: Client360Intervention[];
  impayes: { count: number; max_jours: number };
  dernier_mail_at: string | null;
}): string {
  const parts: string[] = [];
  const last = data.interventions[0];

  if (last) {
    const label = STATUT_INFO[last.statut]?.label ?? last.statut;
    parts.push(`Dernière intervention le ${fmtDateBe(last.date_effective)} (${label.toLowerCase()})`);
    if (last.rapport?.statut === 'transmis' && last.rapport.transmis_at) {
      parts.push(`rapport transmis le ${fmtDateBe(last.rapport.transmis_at)}`);
    } else if (last.rapport_historique_url) {
      parts.push('rapport historique disponible');
    }
  }

  if (data.impayes.count > 0) {
    parts.push(
      data.impayes.count === 1
        ? `1 facture en retard (${data.impayes.max_jours} j)`
        : `${data.impayes.count} factures en retard (max ${data.impayes.max_jours} j)`,
    );
  }

  if (data.dernier_mail_at) {
    parts.push(`dernier mail le ${fmtDateBe(data.dernier_mail_at)}`);
  }

  if (parts.length === 0) return '';
  return parts.join(' · ') + '.';
}
