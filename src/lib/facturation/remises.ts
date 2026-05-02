// Moteur de calcul des remises FoxO sur 3 niveaux : ligne, globale, auto.
//
// Utilisé par :
//   - le PDF (computeTotals dans FacturePdf.tsx / FactureFoxoPdf.tsx)
//   - l'éditeur (FactureEditor.tsx)
//   - les Server Actions (validation à la sauvegarde)
//
// Règle TVA : la remise est appliquée HTVA. La TVA est calculée sur le
// total HT après toutes les remises (lignes + globale).

import type { FactureLigne, RemiseType } from '@/lib/types/database';

export type RemiseInput = {
  valeur: number | null | undefined;
  type: RemiseType | null | undefined;
};

export interface LineComputation {
  brut: number;          // quantite × prix_unitaire (HT, avant remise)
  remise: number;        // montant € de la remise appliquée à la ligne
  net: number;           // brut - remise (HT, après remise ligne)
}

export interface InvoiceTotals {
  lignes: LineComputation[];
  sousTotalBrut: number;        // somme des `brut` (avant toute remise)
  totalRemisesLignes: number;   // somme des remises ligne
  sousTotalApresRemisesLignes: number; // sousTotalBrut - totalRemisesLignes
  remiseGlobale: number;        // montant € de la remise globale appliquée
  totalHt: number;              // sousTotalApresRemisesLignes - remiseGlobale
  tva: number;                  // totalHt × tvaPct/100
  totalTtc: number;             // totalHt + tva
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Applique une remise (pct ou fixe) sur un montant. Borne le résultat à >= 0.
// Si type='fixe' et valeur > montant, la remise est plafonnée à montant
// (pas d'erreur — c'est la règle "ne peut pas dépasser le montant concerné").
export function applyRemise(montant: number, remise: RemiseInput): number {
  const valeur = Number(remise.valeur ?? 0);
  if (!Number.isFinite(valeur) || valeur <= 0) return 0;
  if (remise.type === 'pct') {
    const pct = Math.min(Math.max(valeur, 0), 100);
    return round2(montant * (pct / 100));
  }
  if (remise.type === 'fixe') {
    return round2(Math.min(valeur, Math.max(montant, 0)));
  }
  return 0;
}

export function computeLine(ligne: FactureLigne): LineComputation {
  const brut = round2(Number(ligne.quantite ?? 0) * Number(ligne.prix_unitaire ?? 0));
  const remise = applyRemise(brut, {
    valeur: ligne.remise_valeur,
    type: ligne.remise_type,
  });
  return { brut, remise, net: round2(brut - remise) };
}

export function computeInvoiceTotals(
  lignes: FactureLigne[],
  tvaPct: number,
  remiseGlobale: RemiseInput,
): InvoiceTotals {
  const computed = lignes.map(computeLine);
  const sousTotalBrut = round2(computed.reduce((s, l) => s + l.brut, 0));
  const totalRemisesLignes = round2(computed.reduce((s, l) => s + l.remise, 0));
  const sousTotalApresRemisesLignes = round2(sousTotalBrut - totalRemisesLignes);
  const remiseGlobaleAmount = applyRemise(sousTotalApresRemisesLignes, remiseGlobale);
  const totalHt = round2(sousTotalApresRemisesLignes - remiseGlobaleAmount);
  const tva = round2(totalHt * (Number(tvaPct ?? 0) / 100));
  const totalTtc = round2(totalHt + tva);

  return {
    lignes: computed,
    sousTotalBrut,
    totalRemisesLignes,
    sousTotalApresRemisesLignes,
    remiseGlobale: remiseGlobaleAmount,
    totalHt,
    tva,
    totalTtc,
  };
}

// ─── Validation (Server Action) ─────────────────────────────────────

export type ValidationError = { field: string; message: string };

// Valide une remise (ligne, globale, ou client) : description obligatoire
// si valeur > 0, pct dans [0, 100], fixe positive et <= montant si fourni.
export function validateRemise(
  remise: RemiseInput & { description?: string | null },
  montantPlafond?: number,
  fieldPrefix = 'remise',
): ValidationError[] {
  const errors: ValidationError[] = [];
  const valeur = Number(remise.valeur ?? 0);
  if (!Number.isFinite(valeur)) {
    errors.push({ field: `${fieldPrefix}_valeur`, message: 'Valeur de remise invalide.' });
    return errors;
  }
  if (valeur < 0) {
    errors.push({ field: `${fieldPrefix}_valeur`, message: 'La remise ne peut pas être négative.' });
  }
  if (valeur === 0) return errors;

  if (remise.type !== 'pct' && remise.type !== 'fixe') {
    errors.push({ field: `${fieldPrefix}_type`, message: 'Type de remise requis (pct ou fixe).' });
    return errors;
  }
  if (remise.type === 'pct' && valeur > 100) {
    errors.push({ field: `${fieldPrefix}_valeur`, message: 'La remise en % ne peut pas dépasser 100%.' });
  }
  if (
    remise.type === 'fixe'
    && typeof montantPlafond === 'number'
    && valeur > montantPlafond + 0.005
  ) {
    errors.push({
      field: `${fieldPrefix}_valeur`,
      message: `La remise fixe (${valeur.toFixed(2)} €) ne peut pas dépasser le montant concerné (${montantPlafond.toFixed(2)} €).`,
    });
  }
  if (!remise.description || remise.description.trim().length === 0) {
    errors.push({
      field: `${fieldPrefix}_description`,
      message: 'La description est obligatoire dès qu\'une remise est appliquée.',
    });
  }
  return errors;
}
