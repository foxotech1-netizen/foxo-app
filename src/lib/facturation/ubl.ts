// Générateur UBL 2.1 conforme Peppol BIS Billing 3.0 (chantier Facturation
// v2, bloc Peppol). Fonction PURE, XML construit à la main (aucune dépendance
// externe), échappement systématique de tout contenu dynamique.
//
// Périmètre :
//   - facture (et facture d'acompte) → <Invoice>, InvoiceTypeCode 380
//   - avoir → <CreditNote>, CreditNoteTypeCode 381 (CreditNoteLine)
//   - devis → non supporté (throw)
//
// Point critique : les montants (HT/TVA/TTC) sont calculés par
// computeInvoiceTotals — la MÊME source que le PDF et que les colonnes
// montant_* en base — pour être identiques au centime près. Le moteur FoxO
// calcule la TVA au taux GLOBAL de la facture (facture.tva_pct) ; les
// sous-totaux par taux de ligne sont réconciliés au centime contre ces
// totaux (ajustement d'arrondi sur le plus gros sous-total).

import type { Facture, FactureLigne } from '@/lib/types/database';
import { computeInvoiceTotals } from './remises';
import { VENDOR } from '@/lib/constants/vendor';

// ─── Paramètres fournisseur (AccountingSupplierParty) ─────────────────────

export interface UblSupplierParams {
  nom: string;
  /** N° TVA, ex. « BE1030.109.019 » (normalisé en BE+chiffres dans l'XML). */
  tva: string;
  /** N° BCE, ex. « 1030.109.019 » ou « BE1030.109.019 ». */
  bce: string;
  rue: string;
  codePostal: string;
  ville: string;
  /** IBAN — même source que le QR EPC (VENDOR.iban par défaut). */
  iban: string;
}

// Construit les paramètres fournisseur depuis la table `parametres`
// (clés societe_*), avec fallback sur les constantes VENDOR. L'IBAN reste
// VENDOR.iban : c'est la source utilisée par le QR EPC des PDF.
export function supplierParamsFromMap(map: Record<string, string>): UblSupplierParams {
  const get = (cle: string) => (map[cle] ?? '').trim();
  const rue = [get('societe_rue'), get('societe_numero')].filter(Boolean).join(' ');
  return {
    nom: get('societe_nom') || VENDOR.name,
    tva: get('societe_tva') || VENDOR.vat,
    bce: get('societe_bce') || VENDOR.bce,
    rue: rue || VENDOR.addressLine1,
    codePostal: get('societe_code_postal') || VENDOR.addressLine2.split(' ')[0],
    ville: get('societe_ville') || VENDOR.addressLine2.split(' ').slice(1).join(' '),
    iban: VENDOR.iban,
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** N° d'entreprise belge normalisé : chiffres uniquement (retire BE, points,
 *  espaces). Ex. « BE1030.109.019 » → « 1030109019 ». */
export function normalizeBce(input: string | null | undefined): string {
  return (input ?? '').replace(/^\s*BE/i, '').replace(/\D/g, '');
}

/** N° TVA belge normalisé : « BE » + chiffres. Vide si aucun chiffre. */
export function normalizeVatBe(input: string | null | undefined): string {
  const digits = normalizeBce(input);
  return digits ? `BE${digits}` : '';
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Montant au format UBL : 2 décimales, point décimal, pas de « -0.00 ».
function amt(n: number): string {
  const v = round2(n);
  return (Object.is(v, -0) ? 0 : v).toFixed(2);
}

function qty(n: number): string {
  // Quantité : jusqu'à 2 décimales utiles (les quantités FoxO sont saisies
  // avec au plus 2 décimales).
  const v = round2(n);
  return (Object.is(v, -0) ? 0 : v).toFixed(2);
}

// Catégorie TVA EN16931 : S (taux standard) dès que percent > 0, Z (taux
// zéro) sinon — FoxO ne gère ni exonérations (E) ni autoliquidation (AE).
function taxCategoryId(percent: number): 'S' | 'Z' {
  return percent > 0 ? 'S' : 'Z';
}

// ─── Générateur principal ──────────────────────────────────────────────────

export function buildUblXml(facture: Facture, params: UblSupplierParams): string {
  const docType = facture.type ?? 'facture';
  if (docType === 'devis') {
    throw new Error('UBL non supporté pour les devis — seuls factures et avoirs sont transmissibles via Peppol.');
  }
  if ((facture.numero ?? '').startsWith('BR-')) {
    throw new Error(`Le document ${facture.numero} porte un numéro provisoire : émets-le d'abord pour obtenir son numéro définitif avant de générer l'UBL.`);
  }
  if (!facture.date_emission) {
    throw new Error('Date d\'émission manquante — impossible de générer l\'UBL.');
  }

  const isCreditNote = docType === 'avoir';
  // Un avoir FoxO est stocké en montants NÉGATIFS ; en UBL, une CreditNote
  // porte les montants crédités en POSITIF. On inverse donc le signe de
  // toutes les quantités/montants pour les avoirs.
  const sign = isCreditNote ? -1 : 1;

  const lignes: FactureLigne[] = Array.isArray(facture.lignes) ? facture.lignes : [];
  if (lignes.length === 0) {
    throw new Error('Document sans ligne — impossible de générer l\'UBL.');
  }

  // Totaux : même dérivation que FactureFoxoPdf (fallback legacy remise_pct).
  const newRemiseValeur = Number(facture.remise_globale_valeur ?? 0);
  const remiseGlobale = newRemiseValeur > 0
    ? { valeur: newRemiseValeur, type: facture.remise_globale_type ?? null }
    : Number(facture.remise_pct ?? 0) > 0
      ? { valeur: Number(facture.remise_pct), type: 'pct' as const }
      : { valeur: 0, type: null };
  const totals = computeInvoiceTotals(lignes, facture.tva_pct, remiseGlobale);

  const totalHt = sign * totals.totalHt;
  const totalTva = sign * totals.tva;
  const totalTtc = sign * totals.totalTtc;
  const sousTotalLignes = sign * totals.sousTotalApresRemisesLignes;
  const remiseGlobaleAmount = sign * totals.remiseGlobale;

  // ── Sous-totaux TVA par taux de ligne, réconciliés au centime ─────────
  // Nets par taux (après remise ligne), puis remise globale répartie au
  // prorata ; les écarts d'arrondi (taxable ET taxe) sont absorbés par le
  // plus gros sous-total pour que Σ = totaux du PDF exactement.
  const netByRate = new Map<number, number>();
  lignes.forEach((l, i) => {
    const rate = Number(l.tva_pct ?? facture.tva_pct ?? 0);
    const net = sign * totals.lignes[i].net;
    netByRate.set(rate, round2((netByRate.get(rate) ?? 0) + net));
  });
  const rates = [...netByRate.keys()].sort((a, b) => a - b);
  const sumNets = sousTotalLignes;
  type TaxBucket = { rate: number; taxable: number; tax: number };
  const buckets: TaxBucket[] = rates.map((rate) => {
    const net = netByRate.get(rate)!;
    const allocRemise = sumNets !== 0 ? round2(remiseGlobaleAmount * (net / sumNets)) : 0;
    const taxable = round2(net - allocRemise);
    return { rate, taxable, tax: round2(taxable * rate / 100) };
  });
  if (buckets.length > 0) {
    const biggest = buckets.reduce((a, b) => (Math.abs(b.taxable) > Math.abs(a.taxable) ? b : a));
    biggest.taxable = round2(biggest.taxable + (totalHt - buckets.reduce((s, b) => s + b.taxable, 0)));
    biggest.tax = round2(biggest.tax + (totalTva - buckets.reduce((s, b) => s + b.tax, 0)));
  }

  // ── Parties ────────────────────────────────────────────────────────────
  const supplierBceDigits = normalizeBce(params.bce);
  const supplierVat = normalizeVatBe(params.tva);
  const customerBceDigits = normalizeBce(facture.client_bce);
  const customerVat = normalizeVatBe(facture.client_bce);
  const customerName = (facture.client_nom ?? '').trim() || 'Client';
  // L'adresse client FoxO est un texte libre (« rue, cp ville ») : on
  // l'émet en AddressLine unique + pays BE (seul le pays est obligatoire
  // en BIS 3.0 pour l'acheteur).
  const customerAddress = (facture.client_adresse ?? '').trim();

  const supplierParty = `
    <cac:Party>
      ${supplierBceDigits ? `<cbc:EndpointID schemeID="0208">${esc(supplierBceDigits)}</cbc:EndpointID>` : ''}
      <cac:PartyName><cbc:Name>${esc(params.nom)}</cbc:Name></cac:PartyName>
      <cac:PostalAddress>
        <cbc:StreetName>${esc(params.rue)}</cbc:StreetName>
        <cbc:CityName>${esc(params.ville)}</cbc:CityName>
        <cbc:PostalZone>${esc(params.codePostal)}</cbc:PostalZone>
        <cac:Country><cbc:IdentificationCode>BE</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
      ${supplierVat ? `<cac:PartyTaxScheme>
        <cbc:CompanyID>${esc(supplierVat)}</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>` : ''}
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${esc(params.nom)}</cbc:RegistrationName>
        ${supplierBceDigits ? `<cbc:CompanyID schemeID="0208">${esc(supplierBceDigits)}</cbc:CompanyID>` : ''}
      </cac:PartyLegalEntity>
    </cac:Party>`;

  const customerParty = `
    <cac:Party>
      ${customerBceDigits ? `<cbc:EndpointID schemeID="0208">${esc(customerBceDigits)}</cbc:EndpointID>` : ''}
      <cac:PartyName><cbc:Name>${esc(customerName)}</cbc:Name></cac:PartyName>
      <cac:PostalAddress>
        ${customerAddress ? `<cbc:StreetName>${esc(customerAddress)}</cbc:StreetName>` : ''}
        <cac:Country><cbc:IdentificationCode>BE</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
      ${customerVat ? `<cac:PartyTaxScheme>
        <cbc:CompanyID>${esc(customerVat)}</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>` : ''}
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${esc(customerName)}</cbc:RegistrationName>
        ${customerBceDigits ? `<cbc:CompanyID schemeID="0208">${esc(customerBceDigits)}</cbc:CompanyID>` : ''}
      </cac:PartyLegalEntity>
    </cac:Party>`;

  // ── PaymentMeans (virement SEPA, code 30) ─────────────────────────────
  const iban = params.iban.replace(/\s+/g, '').toUpperCase();
  const bba = (facture.reference_structuree ?? '').trim();
  const paymentMeans = `
  <cac:PaymentMeans>
    <cbc:PaymentMeansCode>30</cbc:PaymentMeansCode>
    ${bba ? `<cbc:PaymentID>${esc(bba)}</cbc:PaymentID>` : ''}
    <cac:PayeeFinancialAccount>
      <cbc:ID>${esc(iban)}</cbc:ID>
    </cac:PayeeFinancialAccount>
  </cac:PaymentMeans>`;

  // ── Remise globale → AllowanceCharge document (BG-20) ─────────────────
  const docAllowance = remiseGlobaleAmount > 0 ? `
  <cac:AllowanceCharge>
    <cbc:ChargeIndicator>false</cbc:ChargeIndicator>
    <cbc:AllowanceChargeReason>${esc(facture.remise_globale_description ?? 'Remise')}</cbc:AllowanceChargeReason>
    <cbc:Amount currencyID="EUR">${amt(remiseGlobaleAmount)}</cbc:Amount>
    <cac:TaxCategory>
      <cbc:ID>${taxCategoryId(Number(facture.tva_pct ?? 0))}</cbc:ID>
      <cbc:Percent>${amt(Number(facture.tva_pct ?? 0))}</cbc:Percent>
      <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
    </cac:TaxCategory>
  </cac:AllowanceCharge>` : '';

  // ── TaxTotal ───────────────────────────────────────────────────────────
  const taxSubtotals = buckets.map((b) => `
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="EUR">${amt(b.taxable)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="EUR">${amt(b.tax)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>${taxCategoryId(b.rate)}</cbc:ID>
        <cbc:Percent>${amt(b.rate)}</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>`).join('');

  const taxTotal = `
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="EUR">${amt(totalTva)}</cbc:TaxAmount>${taxSubtotals}
  </cac:TaxTotal>`;

  // ── LegalMonetaryTotal — au centime près avec le PDF ──────────────────
  const monetaryTotal = `
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="EUR">${amt(sousTotalLignes)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="EUR">${amt(totalHt)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="EUR">${amt(totalTtc)}</cbc:TaxInclusiveAmount>
    ${remiseGlobaleAmount > 0 ? `<cbc:AllowanceTotalAmount currencyID="EUR">${amt(remiseGlobaleAmount)}</cbc:AllowanceTotalAmount>` : ''}
    <cbc:PayableAmount currencyID="EUR">${amt(totalTtc)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>`;

  // ── Lignes ─────────────────────────────────────────────────────────────
  const lineTag = isCreditNote ? 'CreditNoteLine' : 'InvoiceLine';
  const qtyTag = isCreditNote ? 'CreditedQuantity' : 'InvoicedQuantity';
  const linesXml = lignes.map((l, i) => {
    const comp = totals.lignes[i];
    // BR-27 : le prix unitaire UBL ne peut pas être négatif. Les lignes à
    // prix négatif (déduction d'acompte) sont émises en quantité négative
    // avec prix positif — le LineExtensionAmount négatif est autorisé.
    let quantity = sign * Number(l.quantite ?? 0);
    let price = Number(l.prix_unitaire ?? 0);
    if (price < 0) {
      price = -price;
      quantity = -quantity;
    }
    const lea = sign * comp.net;
    const lineRemise = sign * comp.remise;
    const rate = Number(l.tva_pct ?? facture.tva_pct ?? 0);
    const allowance = lineRemise > 0 ? `
      <cac:AllowanceCharge>
        <cbc:ChargeIndicator>false</cbc:ChargeIndicator>
        <cbc:AllowanceChargeReason>${esc(l.remise_description ?? 'Remise')}</cbc:AllowanceChargeReason>
        <cbc:Amount currencyID="EUR">${amt(lineRemise)}</cbc:Amount>
      </cac:AllowanceCharge>` : '';
    return `
  <cac:${lineTag}>
    <cbc:ID>${i + 1}</cbc:ID>
    <cbc:${qtyTag} unitCode="C62">${qty(quantity)}</cbc:${qtyTag}>
    <cbc:LineExtensionAmount currencyID="EUR">${amt(lea)}</cbc:LineExtensionAmount>${allowance}
    <cac:Item>
      <cbc:Name>${esc(l.description || `Ligne ${i + 1}`)}</cbc:Name>
      <cac:ClassifiedTaxCategory>
        <cbc:ID>${taxCategoryId(rate)}</cbc:ID>
        <cbc:Percent>${amt(rate)}</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="EUR">${amt(price)}</cbc:PriceAmount>
    </cac:Price>
  </cac:${lineTag}>`;
  }).join('');

  // ── Document ───────────────────────────────────────────────────────────
  const rootTag = isCreditNote ? 'CreditNote' : 'Invoice';
  const rootNs = isCreditNote
    ? 'urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2'
    : 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2';
  const typeCode = isCreditNote
    ? '<cbc:CreditNoteTypeCode>381</cbc:CreditNoteTypeCode>'
    : '<cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>';
  // BT-10 (BuyerReference) exigé par Peppol (R003) : référence dossier si
  // présente, sinon le numéro de la pièce.
  const buyerReference = (facture.reference ?? '').trim() || facture.numero;
  // DueDate : uniquement sur Invoice (absent du modèle CreditNote EN16931).
  const dueDate = !isCreditNote && facture.date_echeance
    ? `<cbc:DueDate>${esc(facture.date_echeance)}</cbc:DueDate>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<${rootTag} xmlns="${rootNs}"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0</cbc:CustomizationID>
  <cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>
  <cbc:ID>${esc(facture.numero)}</cbc:ID>
  <cbc:IssueDate>${esc(facture.date_emission)}</cbc:IssueDate>
  ${dueDate}
  ${typeCode}
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cbc:BuyerReference>${esc(buyerReference)}</cbc:BuyerReference>
  <cac:AccountingSupplierParty>${supplierParty}
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>${customerParty}
  </cac:AccountingCustomerParty>${paymentMeans}${docAllowance}${taxTotal}${monetaryTotal}${linesXml}
</${rootTag}>
`;
}
