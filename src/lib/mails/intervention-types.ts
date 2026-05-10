// Types et constantes du domaine intervention partagés par les routes
// du pipeline mail (analyse-deep, confirm-and-create).
//
// L'enum DB côté Postgres est strict (NOT NULL avec contrainte CHECK).
// On centralise ici la liste des valeurs autorisées + un type-guard qui
// fallback sur 'Autre' pour neutraliser les drift Claude (typo, valeur
// hors enum, null).

export type TypeIntervention =
  | 'Fuite canalisation'
  | 'Fuite chauffage'
  | 'Fuite infiltration'
  | 'Surconsommation eau'
  | 'Autre';

export const ALLOWED_TYPES_INTERVENTION: TypeIntervention[] = [
  'Fuite canalisation',
  'Fuite chauffage',
  'Fuite infiltration',
  'Surconsommation eau',
  'Autre',
];

export function safeTypeIntervention(raw: string | null | undefined): TypeIntervention {
  if (raw && (ALLOWED_TYPES_INTERVENTION as string[]).includes(raw)) {
    return raw as TypeIntervention;
  }
  return 'Autre';
}
