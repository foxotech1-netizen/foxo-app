// Créneaux fixes FoxO — la journée d'un technicien est découpée en créneaux
// prédéfinis (5 actuellement). Toute la logique planning (vue semaine, grille
// dispos, route bulk, modal de création, listes d'heures des formulaires)
// doit utiliser cette constante comme source unique de vérité — surtout pas
// d'heure libre.
//
// `soiree` distingue les créneaux de fin de journée : le préréglage
// « Semaine standard » de la grille de dispos ne coche que les créneaux de
// journée, « Avec soirées » les coche tous.
//
// Changer la grille ne touche pas aux lignes déjà en base : les créneaux
// créés sur d'anciennes heures (17:00, 19:00…) restent valables, visibles
// au planning avec leur heure réelle, et supprimables depuis la grille de
// dispos (encart « hors grille »). La route bulk refuse de créer un créneau
// qui chevauche une ligne existante du même technicien (slotRangesOverlap).

export const FOXO_SLOTS = [
  { heure_debut: '09:00', heure_fin: '10:30', label: 'Matin 1', soiree: false },
  { heure_debut: '11:00', heure_fin: '12:30', label: 'Matin 2', soiree: false },
  { heure_debut: '13:30', heure_fin: '15:00', label: 'Après-midi 1', soiree: false },
  { heure_debut: '15:30', heure_fin: '17:00', label: 'Après-midi 2', soiree: false },
  { heure_debut: '17:30', heure_fin: '19:00', label: 'Soirée', soiree: true },
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
// dispos créées avant un changement de grille).
export function findSlotByStart(heure_debut: string): FoxoSlot | null {
  const hh = heure_debut.slice(0, 5); // tolère "09:00:00"
  return FOXO_SLOTS.find((s) => s.heure_debut === hh) ?? null;
}

// Minutes depuis minuit d'une heure 'HH:MM' (tolère 'H:MM' et 'HH:MM:SS').
// null si la chaîne n'est pas une heure.
function minutesOf(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

// Index (0..FOXO_SLOTS.length-1) du créneau FoxO dans lequel tombe une heure
// belge 'HH:MM'. Règle unique pour tout placement dans la grille : fenêtre
// [début du créneau, début du créneau suivant). Le premier créneau recueille
// aussi ce qui précède, le dernier ce qui suit : aucune heure n'est « hors
// grille » (avant : comparaison d'heures entières — un évènement à 10:45 ou
// à 15:00 n'apparaissait dans aucune case).
export function slotIdxForTime(hhmm: string): number {
  const minutes = minutesOf(hhmm);
  if (minutes === null) return 0;
  let idx = 0;
  for (let i = 0; i < FOXO_SLOTS.length; i++) {
    const start = minutesOf(FOXO_SLOTS[i].heure_debut);
    if (start !== null && minutes >= start) idx = i;
  }
  return idx;
}

// Vrai si deux plages horaires 'HH:MM' d'un même jour se chevauchent. Bornes
// exclues : 15:30–17:00 et 17:00–18:30 se suivent sans se chevaucher. Faux
// si une heure est illisible ou une plage vide.
export function slotRangesOverlap(aDebut: string, aFin: string, bDebut: string, bFin: string): boolean {
  const a0 = minutesOf(aDebut);
  const a1 = minutesOf(aFin);
  const b0 = minutesOf(bDebut);
  const b1 = minutesOf(bFin);
  if (a0 === null || a1 === null || b0 === null || b1 === null) return false;
  if (a1 <= a0 || b1 <= b0) return false;
  return a0 < b1 && b0 < a1;
}

// Index de la ligne de grille où afficher un créneau enregistré en base :
// la ligne dont la plage horaire recouvre le plus la sienne. Un créneau de la
// grille tombe donc sur sa propre ligne, et un créneau d'une ancienne grille
// (ex. 17:00–18:30) sur la ligne qu'il occupe réellement (17:30–19:00), pas
// sur celle qui le précède. Sans aucun recouvrement (ex. 19:00–21:30) ou si
// l'heure de fin est illisible : règle de fenêtre de slotIdxForTime.
export function slotIdxForRange(heure_debut: string, heure_fin: string | null | undefined): number {
  const debut = minutesOf(heure_debut);
  const fin = heure_fin ? minutesOf(heure_fin) : null;
  if (debut !== null && fin !== null && fin > debut) {
    let best = -1;
    let bestOverlap = 0;
    for (let i = 0; i < FOXO_SLOTS.length; i++) {
      const s0 = minutesOf(FOXO_SLOTS[i].heure_debut);
      const s1 = minutesOf(FOXO_SLOTS[i].heure_fin);
      if (s0 === null || s1 === null) continue;
      const overlap = Math.min(fin, s1) - Math.max(debut, s0);
      if (overlap > bestOverlap) {
        best = i;
        bestOverlap = overlap;
      }
    }
    if (best >= 0) return best;
  }
  return slotIdxForTime(heure_debut);
}

// Heure de début par défaut quand aucune heure n'est précisée (premier
// créneau de la grille) — à utiliser à la place d'un '09:00' écrit en dur.
export const FOXO_DEFAULT_SLOT_START: string = FOXO_SLOTS[0].heure_debut;

// Libellé d'un créneau pour une liste de choix : « 09h00 – 10h30 ».
export function slotLabel(slot: FoxoSlot): string {
  return `${slot.heure_debut.replace(':', 'h')} – ${slot.heure_fin.replace(':', 'h')}`;
}
