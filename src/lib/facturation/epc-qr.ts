// EPC QR Code (SEPA Credit Transfer) pour scan via app bancaire.
// Spec : European Payments Council EPC069-12 v2.1
//
// Format ligne par ligne :
//   BCD                              (Service Tag)
//   002                              (Version)
//   1                                (Character set : UTF-8)
//   SCT                              (Identification : SEPA Credit Transfer)
//   <BIC>                            (optionnel en V2)
//   <Bénéficiaire>                   (max 70)
//   <IBAN sans espaces>              (max 34)
//   EUR<montant>                     (ex: EUR123.45)
//   <Purpose>                        (vide ou OTHR)
//   <Référence structurée>           (BBA si dispo)
//   <Texte communication>            (sinon)
//   <Information>                    (vide)
//
// Doit faire moins de 331 octets. On utilise QRCode.toDataURL côté serveur
// et l'image est embeddée dans le PDF via @react-pdf/renderer <Image>.

import QRCode from 'qrcode';

export interface EpcPayload {
  beneficiaryName: string;     // Fox Group SRL
  iban: string;                // BE62 9502 6652 9861 (espaces tolérés)
  amountEur: number;           // ex: 425.50
  bba?: string;                // 12 chiffres OU forme +++.../...+++
  bic?: string;                // optionnel
  textCommunication?: string;  // utilisé si pas de BBA
}

function cleanIban(iban: string): string {
  return iban.replace(/\s+/g, '').toUpperCase();
}

function fmtAmount(n: number): string {
  // EPC : "EUR" + 2 décimales avec point décimal, sans séparateur de milliers.
  // Min 0.01, max 999999999.99.
  const v = Math.max(0.01, Math.min(999999999.99, Math.round(n * 100) / 100));
  return 'EUR' + v.toFixed(2);
}

function bbaToStructuredRef(bba?: string): string {
  if (!bba) return '';
  const digits = bba.replace(/\D/g, '');
  if (digits.length !== 12) return '';
  // RF Creditor Reference (ISO 11649) n'est pas standard ici ; les apps
  // bancaires belges acceptent le BBA brut dans le champ "Référence
  // structurée" du QR EPC. On envoie les 12 chiffres.
  return digits;
}

export function buildEpcPayloadString(p: EpcPayload): string {
  const iban = cleanIban(p.iban);
  const ref = bbaToStructuredRef(p.bba);
  const remittance = ref ? '' : (p.textCommunication ?? '');

  const lines = [
    'BCD',
    '002',
    '1',
    'SCT',
    p.bic ?? '',
    p.beneficiaryName.slice(0, 70),
    iban,
    fmtAmount(p.amountEur),
    '',                    // Purpose
    ref,                   // Structured creditor reference (BBA)
    remittance.slice(0, 140),
    '',                    // Information
  ];
  return lines.join('\n');
}

// Génère un PNG dataURL prêt à embedder dans le PDF (3cm × 3cm = ~85px à 72dpi).
// Niveau de correction M, taille 256px (suffisant pour scan smartphone).
export async function generateEpcQrDataUrl(p: EpcPayload): Promise<string> {
  const data = buildEpcPayloadString(p);
  return QRCode.toDataURL(data, {
    errorCorrectionLevel: 'M',
    width: 256,
    margin: 1,
    color: { dark: '#1B3A6B', light: '#FFFFFF' },
  });
}
