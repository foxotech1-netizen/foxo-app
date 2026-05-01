// Créneaux fixes FoxO — la journée d'un technicien est découpée en
// EXACTEMENT 5 créneaux. Toute la logique planning (vue semaine, grille
// dispos, route bulk, modal de création) doit utiliser cette constante
// comme source unique de vérité — surtout pas d'heure libre.

export const FOXO_SLOTS = [
  { heure_debut: '09:00', heure_fin: '10:30', label: 'Matin 1' },
  { heure_debut: '11:00', heure_fin: '12:30', label: 'Matin 2' },
  { heure_debut: '13:30', heure_fin: '15:00', label: 'Après-midi' },
  { heure_debut: '17:00', heure_fin: '18:30', label: 'Soir 1' },
  { heure_debut: '19:00', heure_fin: '21:30', label: 'Soir 2' },
] as const;

export type FoxoSlot = typeof FOXO_SLOTS[number];

// Lundi=0 ... Dimanche=6 (convention française vs JS Date.getDay())
export const FOXO_DAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'] as const;
export type FoxoDay = typeof FOXO_DAYS[number];
export const FOXO_DAYS_SHORT = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'] as const;

// Index 0..6 (lundi=0) → nom français
export function dayIdxToName(idx: number): FoxoDay | null {
  return FOXO_DAYS[idx] ?? null;
}
export function dayNameToIdx(name: string): number {
  const i = (FOXO_DAYS as readonly string[]).indexOf(name);
  return i;
}

// Pour un heure_debut donné, retourne le slot FoxO correspondant (ou null
// si l'heure ne correspond à aucun créneau prédéfini — cas d'anciennes
// dispos générées avant la refonte).
export function findSlotByStart(heure_debut: string): FoxoSlot | null {
  const hh = heure_debut.slice(0, 5); // tolère "09:00:00"
  return FOXO_SLOTS.find((s) => s.heure_debut === hh) ?? null;
}
