// src/lib/assistant/tools/foxo-actions.ts
//
// Boîte à outils d'ACTION de l'assistant IA admin (Phase 3).
//
// PRINCIPE DE SÉCURITÉ — ces outils ne MUTENT JAMAIS rien directement.
// Ils PRÉPARENT une proposition (résolution + validation en lecture seule) et renvoient :
//   - resultForModel : un texte que le modèle relaie à l'utilisateur ;
//   - pendingAction  : la proposition structurée (action + paramètres résolus + résumé lisible)
//     que la route attache à sa réponse JSON pour que le front affiche une carte de
//     confirmation avec un bouton « Exécuter ».
// L'exécution réelle se fera UNIQUEMENT via /api/admin/assistant/actions/execute,
// déclenchée par un CLIC humain — jamais par le modèle. Client Supabase reçu = RLS-bound.

import type Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';

export type ActionName = 'assign_technician';

export interface PendingAction {
  id: string;
  action: ActionName;
  params: Record<string, unknown>;
  summary: string;
}

export interface ActionToolResult {
  resultForModel: string;
  pendingAction: PendingAction | null;
}

export const FOXO_ACTION_TOOLS: Anthropic.Tool[] = [
  {
    name: 'propose_assign_technician',
    description:
      "PRÉPARE (sans l'exécuter) l'assignation d'un technicien à une intervention. " +
      "Cet outil NE MODIFIE RIEN : il vérifie que le dossier et le technicien existent et renvoie une proposition. " +
      "L'assignation réelle n'a lieu que si l'administrateur clique ensuite sur le bouton « Exécuter ». " +
      "Après avoir appelé cet outil, annonce clairement la proposition à l'admin (quel technicien, quel dossier) et précise qu'il doit confirmer via le bouton ; ne prétends JAMAIS que l'assignation est faite.",
    input_schema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: "Référence du dossier d'intervention (champ ref, ex : 2026-014)." },
        technicien: { type: 'string', description: "Nom ou prénom (ou partie) du technicien à assigner (ex : « Pierre », « Dupont »)." },
      },
      required: ['ref', 'technicien'],
    },
  },
];

export async function executeFoxoActionTool(
  name: string,
  input: unknown,
  supabase: SupabaseClient,
): Promise<ActionToolResult> {
  try {
    const args = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
    switch (name) {
      case 'propose_assign_technician':
        return await proposeAssignTechnician(args, supabase);
      default:
        return { resultForModel: `Outil d'action inconnu : ${name}.`, pendingAction: null };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'erreur inconnue';
    return { resultForModel: `Erreur lors de la préparation de l'action ${name} : ${msg}`, pendingAction: null };
  }
}

function newProposalId(): string {
  return 'pa_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

async function proposeAssignTechnician(
  args: Record<string, unknown>,
  supabase: SupabaseClient,
): Promise<ActionToolResult> {
  const ref = typeof args.ref === 'string' ? args.ref.trim() : '';
  const techQuery = typeof args.technicien === 'string' ? args.technicien.trim() : '';
  if (!ref) return { resultForModel: "Paramètre 'ref' manquant.", pendingAction: null };
  if (!techQuery) return { resultForModel: "Paramètre 'technicien' manquant.", pendingAction: null };

  const { data: ivData, error: ivErr } = await supabase
    .from('interventions')
    .select('id, ref, technicien_id, adresse')
    .ilike('ref', ref)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle();
  if (ivErr) return { resultForModel: `Erreur de recherche du dossier : ${ivErr.message}`, pendingAction: null };
  const iv = ivData as { id: string; ref: string | null; technicien_id: string | null; adresse: string | null } | null;
  if (!iv) return { resultForModel: `Aucun dossier trouvé pour la référence « ${ref} ».`, pendingAction: null };

  // Récupère les techniciens actifs puis filtre en mémoire avec une correspondance
  // SOUPLE PAR MOTS : on garde ceux dont CHAQUE mot de la requête figure dans le
  // prénom OU le nom. Gère « Tech 1 » (prénom « Tech » + nom « 1 »), « Jean Dupont »,
  // « Dupont » seul, etc. — là où une recherche de la chaîne entière dans un seul
  // champ échouait pour tout nom composé.
  const { data: techData, error: techErr } = await supabase
    .from('utilisateurs')
    .select('id, prenom, nom')
    .eq('role', 'technicien')
    .eq('actif', true)
    .limit(500);
  if (techErr) return { resultForModel: `Erreur de recherche du technicien : ${techErr.message}`, pendingAction: null };
  const allTechs = (techData ?? []) as { id: string; prenom: string | null; nom: string | null }[];

  const tokens = techQuery.toLowerCase().split(/\s+/).filter(Boolean);
  const techs = allTechs.filter((t) => {
    if (tokens.length === 0) return false;
    const prenom = (t.prenom ?? '').toLowerCase();
    const nom = (t.nom ?? '').toLowerCase();
    return tokens.every((tok) => prenom.includes(tok) || nom.includes(tok));
  });

  if (techs.length === 0) {
    return { resultForModel: `Aucun technicien actif ne correspond à « ${techQuery} ». Vérifie le nom.`, pendingAction: null };
  }
  if (techs.length > 1) {
    const liste = techs.map((t) => `${(t.prenom ?? '').trim()} ${(t.nom ?? '').trim()}`.trim()).join(', ');
    return { resultForModel: `Plusieurs techniciens correspondent à « ${techQuery} » : ${liste}. Précise lequel.`, pendingAction: null };
  }

  const tech = techs[0];
  const techNom = `${(tech.prenom ?? '').trim()} ${(tech.nom ?? '').trim()}`.trim() || '(sans nom)';
  const lieu = iv.adresse ?? '—';

  if (iv.technicien_id === tech.id) {
    return { resultForModel: `Le technicien ${techNom} est déjà assigné au dossier ${iv.ref ?? ref}. Aucune action nécessaire.`, pendingAction: null };
  }

  const summary = `Assigner le technicien ${techNom} au dossier ${iv.ref ?? ref}${lieu !== '—' ? ` (${lieu})` : ''}.`;
  const pendingAction: PendingAction = {
    id: newProposalId(),
    action: 'assign_technician',
    params: { interventionId: iv.id, technicienId: tech.id, interventionRef: iv.ref ?? ref, technicienNom: techNom },
    summary,
  };
  const resultForModel =
    `Proposition prête : ${summary} ` +
    `Annonce-la à l'admin et précise qu'il doit cliquer sur « Exécuter » pour confirmer. Ne dis pas que c'est fait.`;
  return { resultForModel, pendingAction };
}
