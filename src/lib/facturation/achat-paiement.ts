// Construction du QR EPC de paiement d'une facture d'ACHAT (virement vers le
// fournisseur). Réutilise STRICTEMENT le même chemin de rendu que la vente
// (generateEpcQrDataUrl → PNG dataURL). Server-only (import 'qrcode').

import { generateEpcQrDataUrl } from './epc-qr';
import { isIbanValid, normalizeIban } from './iban';

export interface AchatPaiementSource {
  fournisseur_nom: string | null;
  iban_paiement: string | null;
  montant_ttc: number | null;
  communication: string | null;
}

/** true si la communication est une communication structurée belge
 *  (+++123/4567/89012+++ — 12 chiffres). Détermine si elle part dans le champ
 *  « référence structurée » du QR (BBA) plutôt qu'en communication libre. */
export function isCommunicationStructuree(comm: string | null | undefined): boolean {
  const c = (comm ?? '').trim();
  return /\+{3}/.test(c) && c.replace(/\D/g, '').length === 12;
}

/**
 * Génère le dataURL du QR EPC de paiement fournisseur, ou null si le paiement
 * n'est pas générable : IBAN formellement invalide (mod-97) ou montant TTC ≤ 0.
 * Les bandeaux d'alerte anti-fraude sont gérés en amont côté UI — ils
 * n'empêchent pas la génération du QR (l'IBAN doit juste être valide).
 */
export async function genererQrPaiementFournisseur(
  src: AchatPaiementSource,
): Promise<string | null> {
  const iban = normalizeIban(src.iban_paiement);
  const ttc = src.montant_ttc ?? 0;
  if (!iban || !isIbanValid(iban) || ttc <= 0) return null;

  const comm = (src.communication ?? '').trim();
  const structuree = isCommunicationStructuree(comm);
  try {
    return await generateEpcQrDataUrl({
      beneficiaryName: (src.fournisseur_nom ?? 'Fournisseur').slice(0, 70),
      iban,
      amountEur: ttc,
      // buildEpcPayloadString tronque déjà le nom à 70 et la communication
      // libre à 140, et extrait les 12 chiffres d'une communication structurée.
      bba: structuree ? comm : undefined,
      textCommunication: structuree ? undefined : (comm || undefined),
    });
  } catch {
    return null;
  }
}
