// Phase 4 U4 — Loader partagé (lecture seule) du contexte de réponse occupant
// d'un thread mail. Mutualisé entre la route GET (affichage de la carte de
// validation) et la route POST confirm (rechargement défensif du contexte
// avant écriture). Aucune écriture ici.
//
// Il relit l'analyse persistée du thread, vérifie qu'il s'agit bien d'une
// réponse occupant rattachée à un dossier, puis rejoue le moteur de matching
// U2 sur les occupants RÉELS du dossier (le résultat sert l'UI et la défense
// côté confirm).

import type { SupabaseClient } from '@supabase/supabase-js';
import { toCanonicalClassification } from '@/lib/mail/categories';
import {
  matchOccupantResponse,
  type OccupantForMatch,
  type OccupantMatchResult,
} from '@/lib/occupants/match-mail-response';
import type { ReponseOccupantIntention } from '@/app/admin/mails/MailAnalyseTypes';

export type OccupantResponseContext =
  | { found: false }
  | { found: true; dossierId: string; match: OccupantMatchResult };

const INTENTIONS: readonly string[] = ['confirme', 'refuse', 'contre_proposition', 'ambigu'];

interface AnalyseRawShape {
  type?: unknown;
  reponse_occupant?: {
    intention?: unknown;
    occupant_cible?: unknown;
  } | null;
}

export async function getOccupantResponseMatch(
  admin: SupabaseClient,
  threadId: string,
): Promise<OccupantResponseContext> {
  const { data: row } = await admin
    .from('mails_analyses')
    .select('classification, dossier_match_id, expediteur, analyse_raw')
    .eq('thread_id', threadId)
    .maybeSingle();

  if (!row) return { found: false };

  const ana = row as {
    classification: string | null;
    dossier_match_id: string | null;
    expediteur: string | null;
    analyse_raw: AnalyseRawShape | null;
  };

  // Classification canonique : colonne si présente, sinon dérivée du type
  // hérité (anciennes lignes). Doit valoir 'reponse_occupant'.
  const canonical = toCanonicalClassification(
    ana.classification ?? (typeof ana.analyse_raw?.type === 'string' ? ana.analyse_raw.type : null),
  );
  if (canonical !== 'reponse_occupant') return { found: false };
  if (!ana.dossier_match_id) return { found: false };

  const ro = ana.analyse_raw?.reponse_occupant;
  if (!ro) return { found: false };

  const intentionRaw = typeof ro.intention === 'string' ? ro.intention : '';
  const intention: ReponseOccupantIntention = INTENTIONS.includes(intentionRaw)
    ? (intentionRaw as ReponseOccupantIntention)
    : 'ambigu';
  const occupantCible = typeof ro.occupant_cible === 'string' && ro.occupant_cible.trim()
    ? ro.occupant_cible.trim()
    : null;

  const { data: occRows } = await admin
    .from('occupants')
    .select('id, nom, prenom, email, appartement, etage, conf')
    .eq('intervention_id', ana.dossier_match_id);
  const occupants = (occRows ?? []) as OccupantForMatch[];

  const match = matchOccupantResponse({
    intention,
    occupantCible,
    expediteur: ana.expediteur,
    occupants,
  });

  return { found: true, dossierId: ana.dossier_match_id, match };
}
