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

export type ActionName =
  | 'assign_technician'
  | 'relance_occupants'
  | 'planifier_rdv'
  | 'valider_rapport'
  | 'transmettre_rapport'
  | 'creer_evenement_agenda'
  | 'brouillon_reponse_mail';

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
  {
    name: 'propose_valider_rapport',
    description:
      "PRÉPARE (sans l'exécuter) la VALIDATION du rapport d'une intervention : le rapport passe de « brouillon » à « validé ». " +
      "Cet outil NE MODIFIE RIEN : il vérifie qu'un rapport existe et qu'il est bien en brouillon, puis renvoie une proposition. " +
      "AUCUN envoi au syndic à ce stade — la validation est une étape interne préalable à la transmission. " +
      "La validation réelle n'a lieu QUE si l'administrateur clique ensuite sur « Exécuter ». " +
      "Après avoir appelé cet outil, annonce clairement la proposition (quel dossier) et précise qu'il doit confirmer via le bouton ; ne prétends JAMAIS que la validation est faite.",
    input_schema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: "Référence du dossier d'intervention (champ ref, ex : 2026-014)." },
      },
      required: ['ref'],
    },
  },
  {
    name: 'propose_transmettre_rapport',
    description:
      "PRÉPARE (sans l'envoyer) la TRANSMISSION du rapport d'une intervention au syndic : envoi RÉEL du rapport PDF par e-mail, avec réponse dans le fil de conversation d'origine. " +
      "Cet outil NE MODIFIE RIEN et N'ENVOIE RIEN : il vérifie qu'un rapport existe et qu'il est au statut « validé ». Un rapport en brouillon doit d'abord être validé ; un rapport déjà transmis ne peut pas être renvoyé via cet outil. " +
      "L'envoi réel n'a lieu QUE si l'administrateur clique ensuite sur « Exécuter ». C'est l'action la plus sensible : un vrai e-mail part chez le syndic. " +
      "Après avoir appelé cet outil, annonce clairement la proposition (quel dossier) et précise qu'il doit confirmer via le bouton ; ne prétends JAMAIS que la transmission est faite.",
    input_schema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: "Référence du dossier d'intervention (champ ref, ex : 2026-014)." },
      },
      required: ['ref'],
    },
  },
  {
    name: 'propose_creer_evenement_agenda',
    description:
      "PRÉPARE (sans le créer) un nouvel événement dans l'agenda Google de la société. " +
      "Cet outil NE CRÉE RIEN : il valide les paramètres et renvoie une proposition. " +
      "L'événement n'est créé QUE si l'administrateur clique ensuite sur « Exécuter ». " +
      "Utilise-le quand l'admin veut poser un rendez-vous, une visite ou un créneau dans l'agenda (différent de planifier_rdv, qui ne touche QUE le statut d'un dossier sans rien mettre à l'agenda). " +
      "Après l'appel, annonce la proposition (titre, date, horaire) et précise qu'il faut confirmer via le bouton ; ne prétends JAMAIS que l'événement est créé.",
    input_schema: {
      type: 'object',
      properties: {
        titre: { type: 'string', description: "Titre de l'événement (ex : « Visite dossier 2026-014 — fuite salle de bain »)." },
        date: { type: 'string', description: "Date au format AAAA-MM-JJ (ex : 2026-06-20)." },
        heure_debut: { type: 'string', description: "Heure de début au format HH:MM sur 24h, heure de Bruxelles (ex : 14:00)." },
        duree_min: { type: 'number', description: "Durée en minutes (défaut 60 si non précisé)." },
        description: { type: 'string', description: "Détails optionnels de l'événement." },
        lieu: { type: 'string', description: "Lieu optionnel (ex : adresse du dossier)." },
      },
      required: ['titre', 'date', 'heure_debut'],
    },
  },
  {
    name: 'propose_brouillon_reponse_mail',
    description:
      "PRÉPARE (sans l'envoyer) un BROUILLON de réponse à un e-mail existant, enregistré dans les Brouillons Gmail de la société (rien n'est envoyé). " +
      "Cet outil NE MODIFIE RIEN et N'ENVOIE RIEN : il renvoie une proposition. Le brouillon n'est créé QUE si l'administrateur clique sur « Exécuter », et il devra ensuite le relire et l'envoyer lui-même depuis Gmail. " +
      "IMPORTANT : identifie d'abord l'e-mail via un outil de lecture (search_emails ou get_email_thread) pour obtenir son identifiant de message, PUIS appelle cet outil avec cet identifiant. La réponse sera rattachée au bon fil. " +
      "Après l'appel, annonce la proposition (à qui, sujet) et précise qu'il faut confirmer via le bouton ; ne prétends JAMAIS que le mail est envoyé.",
    input_schema: {
      type: 'object',
      properties: {
        mailId: { type: 'string', description: "Identifiant du message Gmail le plus récent du fil auquel répondre (obtenu via search_emails / get_email_thread)." },
        corps: { type: 'string', description: "Corps du message de réponse, en français, prêt à être relu par l'admin." },
        destinataire: { type: 'string', description: "Adresse e-mail du destinataire (optionnel ; par défaut l'expéditeur du mail d'origine)." },
        objet: { type: 'string', description: "Objet du mail (optionnel ; par défaut « Re: <objet d'origine> »)." },
      },
      required: ['mailId', 'corps'],
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
      case 'propose_valider_rapport':
        return await proposeValiderRapport(args, supabase);
      case 'propose_transmettre_rapport':
        return await proposeTransmettreRapport(args, supabase);
      case 'propose_creer_evenement_agenda':
        return await proposeCreerEvenementAgenda(args);
      case 'propose_brouillon_reponse_mail':
        return await proposeBrouillonReponseMail(args);
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

async function proposeValiderRapport(
  args: Record<string, unknown>,
  supabase: SupabaseClient,
): Promise<ActionToolResult> {
  const ref = typeof args.ref === 'string' ? args.ref.trim() : '';
  if (!ref) return { resultForModel: "Paramètre 'ref' manquant.", pendingAction: null };

  const { data: ivData, error: ivErr } = await supabase
    .from('interventions')
    .select('id, ref, adresse')
    .ilike('ref', ref)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle();
  if (ivErr) return { resultForModel: `Erreur de recherche du dossier : ${ivErr.message}`, pendingAction: null };
  const iv = ivData as { id: string; ref: string | null; adresse: string | null } | null;
  if (!iv) return { resultForModel: `Aucun dossier trouvé pour la référence « ${ref} ».`, pendingAction: null };

  const { data: rapData, error: rapErr } = await supabase
    .from('rapports')
    .select('statut')
    .eq('intervention_id', iv.id)
    .maybeSingle();
  if (rapErr) return { resultForModel: `Erreur de lecture du rapport : ${rapErr.message}`, pendingAction: null };
  const rap = rapData as { statut: string | null } | null;
  const statut = rap?.statut ?? null;

  if (!rap) {
    return { resultForModel: `Aucun rapport n'existe encore pour le dossier ${iv.ref ?? ref}. Le technicien doit d'abord publier un rapport ; il n'y a rien à valider.`, pendingAction: null };
  }
  if (statut === 'valide') {
    return { resultForModel: `Le rapport du dossier ${iv.ref ?? ref} est déjà validé. Aucune action nécessaire (il peut maintenant être transmis au syndic).`, pendingAction: null };
  }
  if (statut === 'transmis') {
    return { resultForModel: `Le rapport du dossier ${iv.ref ?? ref} a déjà été transmis au syndic : il ne peut plus être (re)validé.`, pendingAction: null };
  }
  if (statut !== 'brouillon') {
    return { resultForModel: `Le rapport du dossier ${iv.ref ?? ref} a un statut inattendu (« ${statut} »). Validation impossible.`, pendingAction: null };
  }

  const lieu = iv.adresse ?? '—';
  const summary =
    `Valider le rapport du dossier ${iv.ref ?? ref}${lieu !== '—' ? ` (${lieu})` : ''} : il passera de « brouillon » à « validé ». ` +
    `Aucun envoi au syndic à ce stade — la transmission est une étape séparée.`;
  const pendingAction: PendingAction = {
    id: newProposalId(),
    action: 'valider_rapport',
    params: { interventionId: iv.id, interventionRef: iv.ref ?? ref },
    summary,
  };
  const resultForModel =
    `Proposition prête : ${summary} ` +
    `Annonce-la à l'admin et précise qu'il doit cliquer sur « Exécuter » pour confirmer. Ne dis pas que c'est fait.`;
  return { resultForModel, pendingAction };
}

async function proposeTransmettreRapport(
  args: Record<string, unknown>,
  supabase: SupabaseClient,
): Promise<ActionToolResult> {
  const ref = typeof args.ref === 'string' ? args.ref.trim() : '';
  if (!ref) return { resultForModel: "Paramètre 'ref' manquant.", pendingAction: null };

  const { data: ivData, error: ivErr } = await supabase
    .from('interventions')
    .select('id, ref, adresse')
    .ilike('ref', ref)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle();
  if (ivErr) return { resultForModel: `Erreur de recherche du dossier : ${ivErr.message}`, pendingAction: null };
  const iv = ivData as { id: string; ref: string | null; adresse: string | null } | null;
  if (!iv) return { resultForModel: `Aucun dossier trouvé pour la référence « ${ref} ».`, pendingAction: null };

  const { data: rapData, error: rapErr } = await supabase
    .from('rapports')
    .select('statut, transmis_at')
    .eq('intervention_id', iv.id)
    .maybeSingle();
  if (rapErr) return { resultForModel: `Erreur de lecture du rapport : ${rapErr.message}`, pendingAction: null };
  const rap = rapData as { statut: string | null; transmis_at: string | null } | null;
  const statut = rap?.statut ?? null;

  if (!rap) {
    return { resultForModel: `Aucun rapport n'existe pour le dossier ${iv.ref ?? ref} : il n'y a rien à transmettre.`, pendingAction: null };
  }
  if (statut === 'brouillon') {
    return { resultForModel: `Le rapport du dossier ${iv.ref ?? ref} n'est pas encore validé (statut « brouillon »). Il doit d'abord être validé avant de pouvoir être transmis au syndic.`, pendingAction: null };
  }
  if (statut === 'transmis') {
    const quand = rap.transmis_at ? ` (le ${rap.transmis_at})` : '';
    return { resultForModel: `Le rapport du dossier ${iv.ref ?? ref} a déjà été transmis au syndic${quand}. Cet outil ne renvoie pas un rapport déjà transmis.`, pendingAction: null };
  }
  if (statut !== 'valide') {
    return { resultForModel: `Le rapport du dossier ${iv.ref ?? ref} a un statut inattendu (« ${statut} »). Transmission impossible.`, pendingAction: null };
  }

  const lieu = iv.adresse ?? '—';
  const summary =
    `⚠️ TRANSMISSION RÉELLE au syndic : envoi du rapport (PDF) du dossier ${iv.ref ?? ref}${lieu !== '—' ? ` (${lieu})` : ''} ` +
    `par e-mail au syndic, avec réponse dans le fil de conversation d'origine. Le dossier passera en statut « transmis ». Cette action est irréversible.`;
  const pendingAction: PendingAction = {
    id: newProposalId(),
    action: 'transmettre_rapport',
    params: { interventionId: iv.id, interventionRef: iv.ref ?? ref },
    summary,
  };
  const resultForModel =
    `Proposition prête : ${summary} ` +
    `Annonce-la à l'admin et précise qu'il doit cliquer sur « Exécuter » pour confirmer l'envoi réel. Ne dis pas que c'est fait.`;
  return { resultForModel, pendingAction };
}

async function proposeCreerEvenementAgenda(
  args: Record<string, unknown>,
): Promise<ActionToolResult> {
  const titre = typeof args.titre === 'string' ? args.titre.trim() : '';
  const date = typeof args.date === 'string' ? args.date.trim() : '';
  const heure = typeof args.heure_debut === 'string' ? args.heure_debut.trim() : '';
  const dureeRaw = typeof args.duree_min === 'number' ? args.duree_min : Number(args.duree_min);
  const duree = Number.isFinite(dureeRaw) && dureeRaw > 0 ? Math.round(dureeRaw) : 60;
  const description = typeof args.description === 'string' ? args.description.trim() : '';
  const lieu = typeof args.lieu === 'string' ? args.lieu.trim() : '';

  if (!titre) return { resultForModel: "Paramètre 'titre' manquant.", pendingAction: null };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { resultForModel: "Paramètre 'date' invalide : attendu AAAA-MM-JJ (ex : 2026-06-20).", pendingAction: null };
  }
  if (!/^\d{2}:\d{2}$/.test(heure)) {
    return { resultForModel: "Paramètre 'heure_debut' invalide : attendu HH:MM sur 24h (ex : 14:00).", pendingAction: null };
  }

  // Heure de fin = début + durée (calcul en UTC pur pour éviter toute dérive de
  // fuseau ; createCalendarEvent ré-attache le fuseau Europe/Brussels).
  const startUtc = new Date(`${date}T${heure}:00Z`);
  const endUtc = new Date(startUtc.getTime() + duree * 60000);
  const p2 = (n: number) => String(n).padStart(2, '0');
  const heureFin = `${p2(endUtc.getUTCHours())}:${p2(endUtc.getUTCMinutes())}`;

  const [yy, mm, dd] = date.split('-');
  const dateFr = `${dd}/${mm}/${yy}`;
  const summary =
    `Créer l'événement « ${titre} » dans l'agenda de la société le ${dateFr} de ${heure} à ${heureFin} (heure de Bruxelles)` +
    `${lieu ? `, lieu : ${lieu}` : ''}.`;

  const pendingAction: PendingAction = {
    id: newProposalId(),
    action: 'creer_evenement_agenda',
    params: { titre, date, heure, duree, description, lieu },
    summary,
  };
  const resultForModel =
    `Proposition prête : ${summary} ` +
    `Annonce-la à l'admin et précise qu'il doit cliquer sur « Exécuter » pour confirmer. Ne dis pas que c'est fait.`;
  return { resultForModel, pendingAction };
}

async function proposeBrouillonReponseMail(
  args: Record<string, unknown>,
): Promise<ActionToolResult> {
  const mailId = typeof args.mailId === 'string' ? args.mailId.trim() : '';
  const corps = typeof args.corps === 'string' ? args.corps.trim() : '';
  const destinataire = typeof args.destinataire === 'string' ? args.destinataire.trim() : '';
  const objet = typeof args.objet === 'string' ? args.objet.trim() : '';

  if (!mailId) return { resultForModel: "Paramètre 'mailId' manquant. Identifie d'abord l'e-mail via search_emails ou get_email_thread.", pendingAction: null };
  if (!corps) return { resultForModel: "Paramètre 'corps' manquant : il faut le texte de la réponse.", pendingAction: null };

  const apercu = corps.length > 90 ? corps.slice(0, 90).trimEnd() + '…' : corps;
  const summary =
    `Créer un brouillon de réponse dans Gmail${destinataire ? ` à ${destinataire}` : ''}${objet ? `, objet « ${objet} »` : ''}. ` +
    `Aperçu : « ${apercu} ». Rien n'est envoyé : le brouillon devra être relu et envoyé depuis Gmail.`;

  const pendingAction: PendingAction = {
    id: newProposalId(),
    action: 'brouillon_reponse_mail',
    params: { mailId, body: corps, to: destinataire, subject: objet },
    summary,
  };
  const resultForModel =
    `Proposition prête : ${summary} ` +
    `Annonce-la à l'admin et précise qu'il doit cliquer sur « Exécuter » pour créer le brouillon. Ne dis pas que le mail est envoyé.`;
  return { resultForModel, pendingAction };
}
