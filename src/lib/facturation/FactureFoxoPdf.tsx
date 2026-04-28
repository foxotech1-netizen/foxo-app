// PDF facture FoxO — template aligné sur le modèle Falco fourni.
//
// Layout :
//   [Logo couleur] [Vendeur Fox Group]              [Bloc client]
//   ─────────────────────────────────────────────────────────────
//   [Titre Facture]
//   [N° / Date / Échéance]   [Référence libre]
//   [Tableau prestations avec notes par ligne en italic]
//   [Détails intervention (optionnel)]
//   [Notes / Remarques libres]
//   [Bas page gauche : conditions paiement + IBAN + BBA + QR]
//   [Bas page droite : totaux HT / TVA / TTC]
//   [Footer fixe : Fox Group · BCE · IBAN · BEOBANK · pagination]

import {
  Document, Page, Text, View, StyleSheet, Image, Link,
} from '@react-pdf/renderer';
import path from 'node:path';
import { VENDOR } from '@/lib/constants/vendor';
import type {
  Facture,
  FactureLigne,
  FactureDetailsIntervention,
} from '@/lib/types/database';

const COLORS = {
  navy: '#1B3A6B',
  ink: '#1C1A16',
  inkMid: '#5A5650',
  inkMuted: '#8A8278',
  border: '#DDD3C3',
  cream: '#FDFBF7',
  sand: '#F5F2EC',
  ambre: '#A17244',
};

const styles = StyleSheet.create({
  page: {
    padding: 32,
    paddingBottom: 56,
    fontFamily: 'Helvetica',
    fontSize: 9,
    color: COLORS.ink,
    backgroundColor: '#FFFFFF',
  },

  // Header
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 18 },
  headerLeft: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', flex: 1 },
  logo: { width: 80, height: 80, objectFit: 'contain' },
  vendorBlock: { fontSize: 8, lineHeight: 1.4, color: COLORS.ink },
  vendorName: { fontSize: 10, fontWeight: 700, color: COLORS.navy, marginBottom: 2 },
  clientBox: {
    width: 220,
    border: 1,
    borderColor: COLORS.border,
    borderRadius: 4,
    padding: 10,
    backgroundColor: COLORS.cream,
  },
  clientLabel: {
    fontSize: 7,
    color: COLORS.inkMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  clientName: { fontSize: 11, fontWeight: 700, color: COLORS.ink, marginBottom: 2 },
  clientLine: { fontSize: 8.5, color: COLORS.inkMid, lineHeight: 1.4 },

  // Titre
  invoiceTitle: {
    fontSize: 22,
    fontWeight: 700,
    color: COLORS.navy,
    letterSpacing: 1,
    marginBottom: 14,
  },

  // Bloc identification (3 colonnes)
  metaRow: {
    flexDirection: 'row',
    gap: 14,
    marginBottom: 14,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  metaCell: { flex: 1 },
  metaLabel: {
    fontSize: 7,
    color: COLORS.inkMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 2,
  },
  metaValue: { fontSize: 11, color: COLORS.ink, fontWeight: 700 },
  metaValueMuted: { fontSize: 10, color: COLORS.inkMid },

  // Tableau prestations
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: COLORS.navy,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 3,
  },
  th: {
    fontSize: 7.5,
    fontWeight: 700,
    color: '#FFFFFF',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 7,
    paddingHorizontal: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.border,
  },
  cellDesc:  { flex: 1, paddingRight: 8 },
  cellQty:   { width: 40, textAlign: 'right' },
  cellPrice: { width: 70, textAlign: 'right' },
  cellTax:   { width: 50, textAlign: 'right' },
  cellTotal: { width: 75, textAlign: 'right' },
  itemTitle: { fontSize: 9.5, color: COLORS.ink },
  itemNote: { fontSize: 8, color: COLORS.inkMid, fontStyle: 'italic', marginTop: 2 },
  itemNum:  { fontSize: 9.5, color: COLORS.ink, fontFamily: 'Courier' },

  // Détails intervention
  detailsBox: {
    marginTop: 14,
    padding: 10,
    border: 1,
    borderColor: COLORS.border,
    borderRadius: 4,
    backgroundColor: COLORS.sand,
  },
  detailsLabel: {
    fontSize: 7,
    color: COLORS.inkMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 4,
    fontWeight: 700,
  },
  detailsLine: { fontSize: 9, color: COLORS.ink, lineHeight: 1.5 },

  // Notes
  notesBox: {
    marginTop: 14,
    padding: 10,
    border: 1,
    borderColor: COLORS.border,
    borderRadius: 4,
    backgroundColor: COLORS.cream,
  },
  notesText: { fontSize: 9, color: COLORS.ink, lineHeight: 1.5 },

  // Bas de page : 2 colonnes
  bottomRow: { flexDirection: 'row', marginTop: 18, gap: 16 },
  bottomLeft: { flex: 1 },
  bottomRight: { width: 220 },

  paymentBlock: {
    backgroundColor: COLORS.cream,
    border: 1,
    borderColor: COLORS.border,
    borderRadius: 4,
    padding: 12,
  },
  paymentLabel: {
    fontSize: 7,
    color: COLORS.inkMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    fontWeight: 700,
    marginBottom: 4,
  },
  paymentLine: { fontSize: 9, color: COLORS.ink, lineHeight: 1.5 },
  paymentBba: {
    fontSize: 11,
    color: COLORS.navy,
    fontFamily: 'Courier',
    fontWeight: 700,
    marginTop: 4,
  },

  qrRow: { flexDirection: 'row', gap: 12, marginTop: 10, alignItems: 'flex-start' },
  qrImg: { width: 85, height: 85 },
  qrCaption: { fontSize: 8, color: COLORS.inkMid, lineHeight: 1.4, flex: 1 },

  // Totaux
  totalsBlock: {
    border: 1,
    borderColor: COLORS.border,
    borderRadius: 4,
    overflow: 'hidden',
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.border,
  },
  totalLabel: { fontSize: 9, color: COLORS.inkMid },
  totalValue: { fontSize: 10, color: COLORS.ink, fontFamily: 'Courier' },
  totalTtcRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 9,
    paddingHorizontal: 12,
    backgroundColor: COLORS.navy,
  },
  totalTtcLabel: {
    fontSize: 11,
    color: '#FFFFFF',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  totalTtcValue: { fontSize: 13, color: '#FFFFFF', fontWeight: 700, fontFamily: 'Courier' },

  // Footer
  footer: {
    position: 'absolute',
    bottom: 24,
    left: 32,
    right: 32,
    fontSize: 7,
    color: COLORS.inkMuted,
    paddingTop: 6,
    borderTopWidth: 0.5,
    borderTopColor: COLORS.border,
  },
  footerLine: { textAlign: 'center', marginBottom: 2 },
  footerPage: { textAlign: 'center', color: COLORS.inkMuted },
});

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fmtMoney(n: number | null | undefined): string {
  const v = typeof n === 'number' ? n : 0;
  return v.toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

function termsDays(emission: string | null, echeance: string | null): number {
  if (!emission || !echeance) return 15;
  const a = new Date(emission).getTime();
  const b = new Date(echeance).getTime();
  return Math.max(0, Math.round((b - a) / 86400000));
}

export interface FactureFoxoPdfProps {
  facture: Facture;
  qrDataUrl?: string;        // data: PNG du QR EPC (généré côté serveur)
  logoSrc?: string;          // chemin absolu vers public/foxo-logo-transparent.png
}

export function FactureFoxoPdf({ facture, qrDataUrl, logoSrc }: FactureFoxoPdfProps) {
  const lignes: FactureLigne[] = Array.isArray(facture.lignes) ? facture.lignes : [];
  const details: FactureDetailsIntervention = facture.details_intervention ?? {};

  const ht = lignes.reduce((s, l) => s + l.quantite * l.prix_unitaire, 0);
  const tva = ht * (facture.tva_pct / 100);
  const ttc = ht + tva;

  const days = termsDays(facture.date_emission, facture.date_echeance);
  const logoPath = logoSrc ?? path.join(process.cwd(), 'public', 'foxo-logo-transparent.png');

  return (
    <Document
      title={`Facture ${facture.numero}`}
      author={VENDOR.name}
      subject={`Facture ${facture.numero}${facture.reference ? ' — ' + facture.reference : ''}`}
    >
      <Page size="A4" style={styles.page}>
        {/* HEADER : logo + vendeur (gauche) + client (droite) */}
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            {logoPath && <Image src={logoPath} style={styles.logo} />}
            <View style={styles.vendorBlock}>
              <Text style={styles.vendorName}>{VENDOR.name}</Text>
              <Text>{VENDOR.addressLine1}</Text>
              <Text>{VENDOR.addressLine2}</Text>
              <Text>{VENDOR.email}</Text>
              <Text>{VENDOR.phone}</Text>
            </View>
          </View>
          <View style={styles.clientBox}>
            <Text style={styles.clientLabel}>Facturé à</Text>
            <Text style={styles.clientName}>{facture.client_nom ?? '—'}</Text>
            {facture.client_bce && <Text style={styles.clientLine}>BCE {facture.client_bce}</Text>}
            {facture.client_syndic && <Text style={styles.clientLine}>{facture.client_syndic}</Text>}
            {facture.client_adresse && <Text style={styles.clientLine}>{facture.client_adresse}</Text>}
            {facture.client_email && <Text style={styles.clientLine}>{facture.client_email}</Text>}
          </View>
        </View>

        {/* TITRE */}
        <Text style={styles.invoiceTitle}>Facture</Text>

        {/* BLOC IDENTIFICATION */}
        <View style={styles.metaRow}>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>N° de facture</Text>
            <Text style={styles.metaValue}>{facture.numero}</Text>
          </View>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Date de facturation</Text>
            <Text style={styles.metaValueMuted}>{fmtDate(facture.date_emission)}</Text>
          </View>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Date d&apos;échéance</Text>
            <Text style={styles.metaValueMuted}>{fmtDate(facture.date_echeance)}</Text>
          </View>
          {facture.reference && (
            <View style={styles.metaCell}>
              <Text style={styles.metaLabel}>Référence</Text>
              <Text style={styles.metaValueMuted}>{facture.reference}</Text>
            </View>
          )}
        </View>

        {/* TABLEAU PRESTATIONS */}
        <View style={styles.tableHeader}>
          <Text style={[styles.th, styles.cellDesc]}>Description</Text>
          <Text style={[styles.th, styles.cellQty]}>Qté</Text>
          <Text style={[styles.th, styles.cellPrice]}>P.U. HT</Text>
          <Text style={[styles.th, styles.cellTax]}>TVA</Text>
          <Text style={[styles.th, styles.cellTotal]}>Montant</Text>
        </View>
        {lignes.map((l, i) => (
          <View key={i} style={styles.tableRow} wrap={false}>
            <View style={styles.cellDesc}>
              <Text style={styles.itemTitle}>{l.description}</Text>
              {l.notes && <Text style={styles.itemNote}>{l.notes}</Text>}
            </View>
            <Text style={[styles.itemNum, styles.cellQty]}>{l.quantite}</Text>
            <Text style={[styles.itemNum, styles.cellPrice]}>{fmtMoney(l.prix_unitaire)}</Text>
            <Text style={[styles.itemNum, styles.cellTax]}>{l.tva_pct}%</Text>
            <Text style={[styles.itemNum, styles.cellTotal]}>{fmtMoney(l.quantite * l.prix_unitaire)}</Text>
          </View>
        ))}

        {/* DÉTAILS INTERVENTION (optionnel) */}
        {(details.ref_dossier || details.appartements || details.adresse_intervention || details.reference_assurance) && (
          <View style={styles.detailsBox}>
            <Text style={styles.detailsLabel}>Détails intervention</Text>
            {details.ref_dossier && (
              <Text style={styles.detailsLine}>Référence dossier : {details.ref_dossier}</Text>
            )}
            {details.appartements && (
              <Text style={styles.detailsLine}>Appartements : {details.appartements}</Text>
            )}
            {details.adresse_intervention && (
              <Text style={styles.detailsLine}>Adresse : {details.adresse_intervention}</Text>
            )}
            {details.reference_assurance && (
              <Text style={styles.detailsLine}>Référence assurance : {details.reference_assurance}</Text>
            )}
          </View>
        )}

        {/* NOTES / REMARQUES libres */}
        {(facture.remarques || facture.notes) && (
          <View style={styles.notesBox}>
            <Text style={styles.detailsLabel}>Notes / Remarques</Text>
            {facture.remarques && <Text style={styles.notesText}>{facture.remarques}</Text>}
            {facture.notes && <Text style={[styles.notesText, { marginTop: 4 }]}>{facture.notes}</Text>}
          </View>
        )}

        {/* BAS DE PAGE : paiement (gauche) + totaux (droite) */}
        <View style={styles.bottomRow}>
          <View style={styles.bottomLeft}>
            <View style={styles.paymentBlock}>
              <Text style={styles.paymentLabel}>Conditions de paiement</Text>
              <Text style={styles.paymentLine}>
                Paiement sous {days} jours ({facture.conditions_paiement}).
              </Text>
              <Text style={styles.paymentLine}>
                Sur ce compte : <Text style={{ fontFamily: 'Courier' }}>{VENDOR.iban}</Text> — {VENDOR.bank}
              </Text>
              {facture.reference_structuree && (
                <>
                  <Text style={[styles.paymentLabel, { marginTop: 8 }]}>Communication structurée</Text>
                  <Text style={styles.paymentBba}>{facture.reference_structuree}</Text>
                </>
              )}
              {qrDataUrl && (
                <View style={styles.qrRow}>
                  <Image src={qrDataUrl} style={styles.qrImg} />
                  <Text style={styles.qrCaption}>
                    Scannez ce code avec votre application bancaire pour pré-remplir le virement.
                  </Text>
                </View>
              )}
            </View>
          </View>
          <View style={styles.bottomRight}>
            <View style={styles.totalsBlock}>
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Montant hors taxes</Text>
                <Text style={styles.totalValue}>{fmtMoney(ht)}</Text>
              </View>
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>TVA {facture.tva_pct}%</Text>
                <Text style={styles.totalValue}>{fmtMoney(tva)}</Text>
              </View>
              <View style={styles.totalTtcRow}>
                <Text style={styles.totalTtcLabel}>Total</Text>
                <Text style={styles.totalTtcValue}>{fmtMoney(ttc)}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* FOOTER */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerLine}>
            {VENDOR.name}   {VENDOR.addressLine1} - {VENDOR.addressLine2}   TVA : {VENDOR.vat} - {VENDOR.bank} {VENDOR.iban}
          </Text>
          <Text
            style={styles.footerPage}
            render={({ pageNumber, totalPages }) => `Page ${pageNumber} / ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  );
}

// Petit helper pour la liste/UI : recalcule les totaux à partir des lignes.
export function computeFactureTotals(
  lignes: FactureLigne[],
  tvaPct: number,
  remisePct = 0,
): { ht: number; tva: number; ttc: number } {
  const brut = lignes.reduce((s, l) => s + l.quantite * l.prix_unitaire, 0);
  const ht = brut * (1 - remisePct / 100);
  const tva = ht * (tvaPct / 100);
  const ttc = ht + tva;
  return { ht: round2(ht), tva: round2(tva), ttc: round2(ttc) };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Lien Beobank/banque : URI EPC simple, fallback en cas d'absence d'app QR.
export function epcWebLink(p: { iban: string; amount: number; bba?: string; benef: string }): string {
  const iban = p.iban.replace(/\s+/g, '');
  const params = new URLSearchParams({
    iban,
    amount: p.amount.toFixed(2),
    benef: p.benef,
  });
  if (p.bba) params.set('bba', p.bba.replace(/\D/g, ''));
  return `https://foxo.be/pay?${params.toString()}`;
}

// Composant React pas exporté en lien — utilisé pour silence typescript si jamais
// `Link` est importé sans usage.
const _LinkPlaceholder = Link;
void _LinkPlaceholder;
