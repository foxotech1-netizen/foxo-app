// Libellés français des états de paiement Odoo, pour l'affichage du miroir
// (odoo_factures.etat_paiement garde la valeur Odoo brute).
//
// Fichier pur, sans dépendance : utilisable côté serveur comme côté client.

export type TonEtat = 'ok' | 'attente' | 'partiel' | 'neutre';
/** Regroupement utilisé par les filtres de l'écran. */
export type GroupeEtat = 'payee' | 'a_regler' | 'partielle' | 'autre';

export interface EtatFactureInfo {
  /** Pastille : « Payée », « À encaisser »… */
  label: string;
  /** Dans une phrase de comptage : « 1 payée », « 3 payées ». */
  un: string;
  plusieurs: string;
  ton: TonEtat;
  groupe: GroupeEtat;
}

/** Classes des pastilles — tokens du thème admin, aucune couleur en dur. */
export const CLASSES_TON: Record<TonEtat, string> = {
  ok: 'bg-ok-light text-ok border-ok-mid',
  attente: 'bg-navy-pale text-navy border-navy-light',
  partiel: 'bg-amber-light text-[var(--color-amber-deep)] border-[var(--color-amber-foxo)]/30',
  neutre: 'bg-sand-mid text-ink-mid border-sand-border',
};

export function etatFacture(etat: string, sens: 'vente' | 'achat'): EtatFactureInfo {
  switch (etat) {
    case 'paid':
      return { label: 'Payée', un: 'payée', plusieurs: 'payées', ton: 'ok', groupe: 'payee' };
    case 'in_payment':
      return { label: 'En paiement', un: 'en paiement', plusieurs: 'en paiement', ton: 'ok', groupe: 'payee' };
    case 'not_paid':
      return sens === 'vente'
        ? { label: 'À encaisser', un: 'à encaisser', plusieurs: 'à encaisser', ton: 'attente', groupe: 'a_regler' }
        : { label: 'À payer', un: 'à payer', plusieurs: 'à payer', ton: 'attente', groupe: 'a_regler' };
    case 'partial':
      return { label: 'Partielle', un: 'partielle', plusieurs: 'partielles', ton: 'partiel', groupe: 'partielle' };
    case 'reversed':
      return { label: 'Extournée', un: 'extournée', plusieurs: 'extournées', ton: 'neutre', groupe: 'autre' };
    case 'blocked':
      return { label: 'Bloquée', un: 'bloquée', plusieurs: 'bloquées', ton: 'neutre', groupe: 'autre' };
    default:
      // État Odoo inconnu de FoxO : on l'affiche tel quel plutôt que de le masquer.
      return { label: etat, un: etat, plusieurs: etat, ton: 'neutre', groupe: 'autre' };
  }
}
