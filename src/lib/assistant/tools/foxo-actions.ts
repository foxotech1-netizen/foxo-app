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

export type ActionName = 'assign_technician' | 'relance_occupants' | 'planifier_rdv';

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
  {
    name: 'propose_relance_occupant',
    description:
      "PRÉPARE (sans l'envoyer) une relance des occupants d'une intervention : l'envoi d'une demande de confirmation de rendez-vous (email, et SMS/WhatsApp si coordonnées disponibles). " +
      "Cet outil NE MODIFIE RIEN et N'ENVOIE RIEN : il vérifie que le dossier a un créneau planifié et au moins un occupant, puis renvoie une proposition portant sur TOUS les occupants du dossier. " +
      "L'envoi réel n'a lieu QUE si l'administrateur clique ensuite sur le bouton « Exécuter ». " +
      "Après avoir appelé cet outil, annonce clairement la proposition (combien d'occupants, quel dossier) et précise qu'il doit confirmer via le bouton ; ne prétends JAMAIS que la relance est partie.",
    input_schema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: "Référence du dossier d'intervention (champ ref, ex : 2026-014)." },
      },
      required: ['ref'],
    },
  },
  {
    name: 'propose_planifier_rdv',
    description:
      "PRÉPARE (sans l'exécuter) la planification d'un rendez-vous pour une intervention : pose une date et une heure proposées. " +
      "Cet outil NE MODIFIE RIEN : il vérifie que le dossier existe et que la date/heure sont valides, puis renvoie une proposition. " +
      "La planification réelle (le dossier passe alors en statut « attente », SANS envoi d'email ni création d'événement agenda) n'a lieu QUE si l'administrateur clique ensuite sur « Exécuter ». " +
      "Après avoir appelé cet outil, annonce clairement la proposition (quel dossier, quelle date et heure) et précise qu'il doit confirmer via le bouton ; ne prétends JAMAIS que le rendez-vous est planifié.",
    input_schema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: "Référence du dossier d'intervention (champ ref, ex : 2026-014)." },
        date: { type: 'string', description: "Date du rendez-vous au format AAAA-MM-JJ (ex : 2026-06-09)." },
        heure: { type: 'string', description: "Heure du rendez-vous au format HH:MM sur 24h (ex : 14:00)." },
      },
      required: ['ref', 'date', 'heure'],
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
      case 'propose_relance_occupant':
        return await proposeRelanceOccupants(args, supabase);
      case 'propose_planifier_rdv':
        return await proposePlanifierRdv(args, supabase);
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

async function proposeRelanceOccupants(
  args: Record<string, unknown>,
  supabase: SupabaseClient,
): Promise<ActionToolResult> {
  const ref = typeof args.ref === 'string' ? args.ref.trim() : '';
  if (!ref) return { resultForModel: "Paramètre 'ref' manquant.", pendingAction: null };

  const { data: ivData, error: ivErr } = await supabase
    .from('interventions')
    .select('id, ref, creneau_debut, adresse')
    .ilike('ref', ref)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle();
  if (ivErr) return { resultForModel: `Erreur de recherche du dossier : ${ivErr.message}`, pendingAction: null };
  const iv = ivData as { id: string; ref: string | null; creneau_debut: string | null; adresse: string | null } | null;
  if (!iv) return { resultForModel: `Aucun dossier trouvé pour la référence « ${ref} ».`, pendingAction: null };

  if (!iv.creneau_debut) {
    return {
      resultForModel: `Le dossier ${iv.ref ?? ref} n'a pas encore de créneau de rendez-vous planifié : impossible de relancer les occupants pour confirmation tant qu'aucune date n'est fixée. Planifie d'abord un créneau.`,
      pendingAction: null,
    };
  }

  const { data: occData, error: occErr } = await supabase
    .from('occupants')
    .select('id, prenom, nom, email, telephone')
    .eq('intervention_id', iv.id);
  if (occErr) return { resultForModel: `Erreur de recherche des occupants : ${occErr.message}`, pendingAction: null };
  const occupants = (occData ?? []) as { id: string; prenom: string | null; nom: string | null; email: string | null; telephone: string | null }[];

  if (occupants.length === 0) {
    return { resultForModel: `Aucun occupant enregistré sur le dossier ${iv.ref ?? ref}. Il n'y a personne à relancer.`, pendingAction: null };
  }

  const noms = occupants
    .map((o) => `${(o.prenom ?? '').trim()} ${(o.nom ?? '').trim()}`.trim() || (o.email ?? '').trim() || (o.telephone ?? '').trim() || 'occupant')
    .join(', ');
  const occupantIds = occupants.map((o) => o.id);
  const lieu = iv.adresse ?? '—';

  const summary =
    `Relancer ${occupants.length} occupant(s) du dossier ${iv.ref ?? ref}${lieu !== '—' ? ` (${lieu})` : ''} : ${noms}. ` +
    `Envoi RÉEL d'une demande de confirmation de rendez-vous (email, et SMS/WhatsApp si coordonnées disponibles).`;

  const pendingAction: PendingAction = {
    id: newProposalId(),
    action: 'relance_occupants',
    params: { interventionId: iv.id, occupantIds, interventionRef: iv.ref ?? ref, occupantsCount: occupants.length },
    summary,
  };
  const resultForModel =
    `Proposition prête : ${summary} ` +
    `Annonce-la à l'admin et précise qu'il doit cliquer sur « Exécuter » pour confirmer l'envoi. Ne dis pas que c'est fait.`;
  return { resultForModel, pendingAction };
}

async function proposePlanifierRdv(
  args: Record<string, unknown>,
  supabase: SupabaseClient,
): Promise<ActionToolResult> {
  const ref = typeof args.ref === 'string' ? args.ref.trim() : '';
  const date = typeof args.date === 'string' ? args.date.trim() : '';
  const heure = typeof args.heure === 'string' ? args.heure.trim() : '';
  if (!ref) return { resultForModel: "Paramètre 'ref' manquant.", pendingAction: null };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { resultForModel: "Paramètre 'date' invalide : attendu AAAA-MM-JJ (ex : 2026-06-09).", pendingAction: null };
  }
  if (!/^\d{2}:\d{2}$/.test(heure)) {
    return { resultForModel: "Paramètre 'heure' invalide : attendu HH:MM sur 24h (ex : 14:00).", pendingAction: null };
  }

  const { data: ivData, error: ivErr } = await supabase
    .from('interventions')
    .select('id, ref, creneau_debut, adresse')
    .ilike('ref', ref)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle();
  if (ivErr) return { resultForModel: `Erreur de recherche du dossier : ${ivErr.message}`, pendingAction: null };
  const iv = ivData as { id: string; ref: string | null; creneau_debut: string | null; adresse: string | null } | null;
  if (!iv) return { resultForModel: `Aucun dossier trouvé pour la référence « ${ref} ».`, pendingAction: null };

  const [yy, mm, dd] = date.split('-');
  const dateFr = `${dd}/${mm}/${yy}`;
  const lieu = iv.adresse ?? '—';

  let summary =
    `Planifier le rendez-vous du dossier ${iv.ref ?? ref}${lieu !== '—' ? ` (${lieu})` : ''} au ${dateFr} à ${heure}. ` +
    `Le dossier passera en statut « attente » (à confirmer ensuite par les occupants). Aucun email ni événement agenda envoyé à ce stade.`;
  if (iv.creneau_debut) {
    summary += ` ⚠️ Remplace le créneau actuellement enregistré sur ce dossier.`;
  }

  const pendingAction: PendingAction = {
    id: newProposalId(),
    action: 'planifier_rdv',
    params: { interventionId: iv.id, date, heure, interventionRef: iv.ref ?? ref },
    summary,
  };
  const resultForModel =
    `Proposition prête : ${summary} ` +
    `Annonce-la à l'admin et précise qu'il doit cliquer sur « Exécuter » pour confirmer. Ne dis pas que c'est fait.`;
  return { resultForModel, pendingAction };
}
