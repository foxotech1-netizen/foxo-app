// Phase 4 U2 — Moteur de matching d'une réponse occupant reçue par mail.
//
// Helper PUR et déterministe : AUCUN appel DB, AUCUN client Supabase, AUCUNE
// écriture, AUCUNE I/O. Il reçoit les occupants DÉJÀ chargés en paramètre —
// c'est la route appelante (U3) qui fera le fetch et l'éventuelle écriture.
//
// Rôle : à partir de l'intention extraite par l'IA (analyse-deep, U1), de la
// cible textuelle (`occupant_cible`) et de l'expéditeur brut du mail, décider
// QUEL occupant du dossier est concerné et avec QUEL niveau de certitude — sans
// jamais confirmer automatiquement à la place d'un humain.
//
// LIMITATIONS ASSUMÉES :
//   - matchByName s'appuie sur `occupant_cible` (texte distillé par l'IA), PAS
//     sur le corps brut du mail. Si l'IA n'a pas isolé de cible, le matching
//     par nom ne peut rien faire (retour conservateur : 'ambigu' / candidats).
//   - `occupantSur` n'est JAMAIS rempli hors niveau 'sur'. Tout doute mène à
//     'ambigu' ou 'probable' (candidats à valider manuellement), jamais à une
//     confirmation silencieuse.
//   - Un refus / une contre-proposition n'est JAMAIS appliqué automatiquement
//     (niveau 'refus_contre' = décision de planning manuelle).

import type { ReponseOccupantIntention } from '@/app/admin/mails/MailAnalyseTypes';

export interface OccupantForMatch {
  id: string;
  nom: string | null;
  prenom: string | null;
  email: string | null;
  appartement: string | null;
  etage: string | null;
  conf: string | null;
}

export type OccupantMatchLevel = 'sur' | 'probable' | 'ambigu' | 'refus_contre';

export interface OccupantMatchResult {
  niveau: OccupantMatchLevel;
  intention: ReponseOccupantIntention;
  occupantSur: OccupantForMatch | null;   // rempli UNIQUEMENT si niveau === 'sur'
  candidats: OccupantForMatch[];           // probable (1) / ambigu (0..n) / refus_contre (0..n, informatif)
  raison: string;                          // explication courte FR, pour la carte UI et le journal
}

// Extrait l'adresse email d'un champ From brut (« Nom <a@b.c> » ou « a@b.c »).
// Retourne l'email en minuscules trimé, ou null si rien d'exploitable.
export function parseSenderEmail(expediteur: string | null | undefined): string | null {
  if (typeof expediteur !== 'string') return null;
  const s = expediteur.trim();
  if (!s) return null;
  // Forme « Nom <email> » : on prend ce qui est entre chevrons en priorité.
  const angle = s.match(/<([^>]+)>/);
  const candidate = (angle ? angle[1] : s).trim();
  // Validation minimale : présence d'un « @ » entouré de caractères non-espace.
  const emailMatch = candidate.match(/[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+/);
  if (!emailMatch) return null;
  return emailMatch[0].toLowerCase();
}

// Normalise une chaîne pour comparaison tolérante : minuscule, suppression des
// accents (NFD + retrait des diacritiques), espaces compactés, trim.
function normalise(s: string | null | undefined): string {
  if (typeof s !== 'string') return '';
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// matchByName — PRIVÉ, conservateur. Un occupant matche si SON nom (normalisé,
// longueur ≥ 3) est présent comme sous-chaîne dans la cible normalisée, OU si
// son appartement (normalisé, longueur ≥ 2) y est présent. On n'utilise NI le
// prénom seul NI l'étage seul (trop de faux positifs). Dédupliqué par id.
function matchByName(
  cible: string | null,
  occupants: OccupantForMatch[],
): OccupantForMatch[] {
  const cibleNorm = normalise(cible);
  if (!cibleNorm) return [];

  const seen = new Set<string>();
  const matched: OccupantForMatch[] = [];
  for (const occ of occupants) {
    if (seen.has(occ.id)) continue;
    const nomNorm = normalise(occ.nom);
    const aptNorm = normalise(occ.appartement);
    const hitNom = nomNorm.length >= 3 && cibleNorm.includes(nomNorm);
    const hitApt = aptNorm.length >= 2 && cibleNorm.includes(aptNorm);
    if (hitNom || hitApt) {
      seen.add(occ.id);
      matched.push(occ);
    }
  }
  return matched;
}

// Cœur du moteur. PUR et déterministe.
export function matchOccupantResponse(input: {
  intention: ReponseOccupantIntention;
  occupantCible: string | null;   // texte libre extrait par l'IA (occupant_cible)
  expediteur: string | null;      // From brut du mail
  occupants: OccupantForMatch[];  // occupants du dossier lié (peut être vide)
}): OccupantMatchResult {
  const { intention, occupantCible, expediteur, occupants } = input;
  const safeOccupants = Array.isArray(occupants) ? occupants : [];

  // 1. Refus / contre-proposition → JAMAIS automatique. Décision de planning
  //    manuelle. On fournit malgré tout des candidats informatifs.
  if (intention === 'refuse' || intention === 'contre_proposition') {
    const byName = matchByName(occupantCible, safeOccupants);
    return {
      niveau: 'refus_contre',
      intention,
      occupantSur: null,
      candidats: byName.length > 0 ? byName : safeOccupants,
      raison: 'Refus/contre-proposition — décision de planning manuelle requise.',
    };
  }

  // 2. Confirmation.
  if (intention === 'confirme') {
    // a. Match certain par email expéditeur = email occupant enregistré.
    const sender = parseSenderEmail(expediteur);
    if (sender) {
      const sameEmail = safeOccupants.filter(
        (o) => typeof o.email === 'string' && o.email.trim().toLowerCase() === sender,
      );
      if (sameEmail.length === 1) {
        return {
          niveau: 'sur',
          intention,
          occupantSur: sameEmail[0],
          candidats: [],
          raison: 'Email expéditeur = email occupant enregistré.',
        };
      }
      if (sameEmail.length > 1) {
        // Plusieurs occupants partagent le même email : ce n'est PAS sûr.
        return {
          niveau: 'ambigu',
          intention,
          occupantSur: null,
          candidats: sameEmail,
          raison: 'Plusieurs occupants partagent cet email — validation manuelle.',
        };
      }
    }

    // b. Sinon, rapprochement conservateur par nom/appartement.
    const byName = matchByName(occupantCible, safeOccupants);
    if (byName.length === 1) {
      return {
        niveau: 'probable',
        intention,
        occupantSur: null,
        candidats: byName,
        raison: 'Rapprochement par nom/appartement.',
      };
    }
    return {
      niveau: 'ambigu',
      intention,
      occupantSur: null,
      candidats: byName.length > 0 ? byName : safeOccupants,
      raison: byName.length > 1
        ? 'Plusieurs occupants possibles — validation manuelle.'
        : 'Aucun occupant identifié avec certitude — validation manuelle.',
    };
  }

  // 3. Intention ambiguë (ou toute autre valeur) → validation manuelle.
  const byName = matchByName(occupantCible, safeOccupants);
  return {
    niveau: 'ambigu',
    intention,
    occupantSur: null,
    candidats: byName.length > 0 ? byName : safeOccupants,
    raison: 'Intention ambiguë — validation manuelle.',
  };
}
