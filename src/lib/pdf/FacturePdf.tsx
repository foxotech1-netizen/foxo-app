import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import { VENDOR } from '@/lib/constants/vendor';

export type FactureItem = {
  description: string;
  quantity: number;
  unitPrice: number; // HT, en EUR
};

export type FacturePdfData = {
  numero: string;
  dateEmission: string;       // ISO
  dateEcheance: string;       // ISO
  ref: string;
  client: {
    nom: string;
    type: 'syndic' | 'courtier';
    adresse: string | null;
    bce: string | null;
  };
  serviceLocation: {
    acpNom: string;
    adresse: string;          // adresse complète
  };
  bonCommande: string | null;
  items: FactureItem[];
  vatRate: number;            // ex: 21
  notes: string;
};

const COLORS = {
  navy: '#1B3A6B',
  ink: '#1C1A16',
  inkMid: '#6B6558',
  inkMuted: '#A09A8E',
  border: '#DDD8CC',
  cream: '#FDFBF7',
  sand: '#F5F2EC',
};

const styles = StyleSheet.create({
  page: { padding: 40, fontFamily: 'Helvetica', fontSize: 10, color: COLORS.ink, backgroundColor: '#FFFFFF' },

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: COLORS.navy, marginBottom: 18 },
  brand: { fontSize: 22, fontWeight: 700, color: COLORS.navy, letterSpacing: 1 },
  brandSub: { fontSize: 8, color: COLORS.inkMuted, marginTop: 2, letterSpacing: 1, textTransform: 'uppercase' },
  vendorBlock: { fontSize: 8, color: COLORS.inkMid, marginTop: 6, lineHeight: 1.5 },

  meta: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 },
  invoiceTitle: { fontSize: 14, fontWeight: 700, color: COLORS.ink, letterSpacing: 1, textTransform: 'uppercase' },
  metaTable: { width: 220 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', borderBottomWidth: 0.5, borderBottomColor: COLORS.border, paddingVertical: 3 },
  metaLabel: { fontSize: 9, color: COLORS.inkMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  metaValue: { fontSize: 10, color: COLORS.ink, fontFamily: 'Courier' },

  parties: { flexDirection: 'row', gap: 24, marginBottom: 16 },
  partyBox: { flex: 1, backgroundColor: COLORS.cream, border: 1, borderColor: COLORS.border, borderRadius: 4, padding: 12 },
  partyLabel: { fontSize: 8, color: COLORS.inkMuted, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 },
  partyName: { fontSize: 11, fontWeight: 700, color: COLORS.ink, marginBottom: 4 },
  partyLine: { fontSize: 9, color: COLORS.inkMid, lineHeight: 1.4 },

  serviceBox: { backgroundColor: COLORS.sand, border: 1, borderColor: COLORS.border, borderRadius: 4, padding: 10, marginBottom: 16 },
  serviceLabel: { fontSize: 8, color: COLORS.inkMuted, letterSpacing: 1, textTransform: 'uppercase' },
  serviceText: { fontSize: 10, color: COLORS.ink, marginTop: 3 },

  itemsHeader: { flexDirection: 'row', backgroundColor: COLORS.navy, color: '#FFFFFF', paddingVertical: 6, paddingHorizontal: 8, borderRadius: 3 },
  itemsHeaderCell: { fontSize: 8, fontWeight: 700, color: '#FFFFFF', textTransform: 'uppercase', letterSpacing: 0.5 },
  itemsRow: { flexDirection: 'row', paddingVertical: 7, paddingHorizontal: 8, borderBottomWidth: 0.5, borderBottomColor: COLORS.border },
  cellDesc: { flex: 1, paddingRight: 8 },
  cellQty:  { width: 50, textAlign: 'right' },
  cellPrice:{ width: 80, textAlign: 'right' },
  cellTotal:{ width: 80, textAlign: 'right' },
  itemText: { fontSize: 10, color: COLORS.ink },
  itemTextMuted: { fontSize: 9, color: COLORS.inkMuted },

  totalsBlock: { marginTop: 12, marginLeft: 'auto', width: 240 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  totalLabel: { fontSize: 10, color: COLORS.inkMid },
  totalValue: { fontSize: 10, color: COLORS.ink, fontFamily: 'Courier' },
  totalTtcRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderTopWidth: 1.5, borderTopColor: COLORS.navy, marginTop: 4 },
  totalTtcLabel: { fontSize: 11, color: COLORS.navy, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 },
  totalTtcValue: { fontSize: 13, color: COLORS.navy, fontWeight: 700, fontFamily: 'Courier' },

  notesBlock: { marginTop: 18, padding: 10, backgroundColor: COLORS.cream, border: 1, borderColor: COLORS.border, borderRadius: 4 },
  notesLabel: { fontSize: 8, color: COLORS.inkMuted, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 },
  notesText: { fontSize: 9, color: COLORS.inkMid, lineHeight: 1.4 },

  paymentBlock: { marginTop: 14, padding: 12, backgroundColor: '#EBF2FB', borderRadius: 4 },
  paymentTitle: { fontSize: 9, fontWeight: 700, color: COLORS.navy, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  paymentLine: { fontSize: 9, color: COLORS.ink, lineHeight: 1.5 },

  footer: { position: 'absolute', bottom: 28, left: 40, right: 40, fontSize: 7, color: COLORS.inkMuted, flexDirection: 'row', justifyContent: 'space-between', paddingTop: 6, borderTopWidth: 0.5, borderTopColor: COLORS.border },
});

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fmtMoney(n: number): string {
  return n.toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

export function computeTotals(items: FactureItem[], vatRate: number) {
  const ht = items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
  const tva = ht * (vatRate / 100);
  const ttc = ht + tva;
  return { ht: round2(ht), tva: round2(tva), ttc: round2(ttc) };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function FacturePdf({ data }: { data: FacturePdfData }) {
  const totals = computeTotals(data.items, data.vatRate);

  return (
    <Document
      title={`Facture ${data.numero}`}
      author={VENDOR.name}
      subject={`Facture intervention ${data.ref}`}
    >
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>FoxO</Text>
            <Text style={styles.brandSub}>Détection de fuites — Belgique</Text>
            <View style={styles.vendorBlock}>
              <Text>{VENDOR.name}</Text>
              {VENDOR.addressLine1 && <Text>{VENDOR.addressLine1}</Text>}
              {VENDOR.addressLine2 && <Text>{VENDOR.addressLine2}{VENDOR.country ? ', ' + VENDOR.country : ''}</Text>}
              <Text>BCE : {VENDOR.bce} · TVA : {VENDOR.vat}</Text>
              <Text>
                {VENDOR.email}
                {VENDOR.phone ? ' · ' + VENDOR.phone : ''}
                {VENDOR.website ? ' · ' + VENDOR.website : ''}
              </Text>
            </View>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.invoiceTitle}>Facture</Text>
            <View style={styles.metaTable}>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>N°</Text>
                <Text style={styles.metaValue}>{data.numero}</Text>
              </View>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Émise le</Text>
                <Text style={styles.metaValue}>{fmtDate(data.dateEmission)}</Text>
              </View>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Échéance</Text>
                <Text style={styles.metaValue}>{fmtDate(data.dateEcheance)}</Text>
              </View>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Réf. interv.</Text>
                <Text style={styles.metaValue}>{data.ref}</Text>
              </View>
              {data.bonCommande && (
                <View style={styles.metaRow}>
                  <Text style={styles.metaLabel}>Bon de cmd</Text>
                  <Text style={styles.metaValue}>{data.bonCommande}</Text>
                </View>
              )}
            </View>
          </View>
        </View>

        {/* Parties */}
        <View style={styles.parties}>
          <View style={styles.partyBox}>
            <Text style={styles.partyLabel}>Vendeur</Text>
            <Text style={styles.partyName}>{VENDOR.name}</Text>
            {VENDOR.addressLine1 && <Text style={styles.partyLine}>{VENDOR.addressLine1}</Text>}
            <Text style={styles.partyLine}>BCE {VENDOR.bce}</Text>
            <Text style={styles.partyLine}>TVA {VENDOR.vat}</Text>
          </View>
          <View style={styles.partyBox}>
            <Text style={styles.partyLabel}>Facturé à</Text>
            <Text style={styles.partyName}>{data.client.nom}</Text>
            <Text style={styles.partyLine}>
              {data.client.type === 'courtier' ? 'Courtier d\'assurance' : 'Syndic'}
            </Text>
            {data.client.adresse && <Text style={styles.partyLine}>{data.client.adresse}</Text>}
            {data.client.bce && <Text style={styles.partyLine}>BCE {data.client.bce}</Text>}
          </View>
        </View>

        {/* Lieu prestation */}
        <View style={styles.serviceBox}>
          <Text style={styles.serviceLabel}>Lieu de prestation</Text>
          <Text style={styles.serviceText}>{data.serviceLocation.acpNom}</Text>
          <Text style={styles.serviceText}>{data.serviceLocation.adresse}</Text>
        </View>

        {/* Lignes */}
        <View style={styles.itemsHeader}>
          <Text style={[styles.itemsHeaderCell, styles.cellDesc]}>Description</Text>
          <Text style={[styles.itemsHeaderCell, styles.cellQty]}>Qté</Text>
          <Text style={[styles.itemsHeaderCell, styles.cellPrice]}>P.U. HT</Text>
          <Text style={[styles.itemsHeaderCell, styles.cellTotal]}>Total HT</Text>
        </View>
        {data.items.map((item, i) => (
          <View key={i} style={styles.itemsRow} wrap={false}>
            <View style={styles.cellDesc}>
              <Text style={styles.itemText}>{item.description}</Text>
            </View>
            <Text style={[styles.itemText, styles.cellQty]}>{item.quantity}</Text>
            <Text style={[styles.itemText, styles.cellPrice]}>{fmtMoney(item.unitPrice)}</Text>
            <Text style={[styles.itemText, styles.cellTotal]}>{fmtMoney(item.quantity * item.unitPrice)}</Text>
          </View>
        ))}

        {/* Totaux */}
        <View style={styles.totalsBlock}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total HT</Text>
            <Text style={styles.totalValue}>{fmtMoney(totals.ht)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>TVA {data.vatRate}%</Text>
            <Text style={styles.totalValue}>{fmtMoney(totals.tva)}</Text>
          </View>
          <View style={styles.totalTtcRow}>
            <Text style={styles.totalTtcLabel}>Total TTC</Text>
            <Text style={styles.totalTtcValue}>{fmtMoney(totals.ttc)}</Text>
          </View>
        </View>

        {/* Notes */}
        {data.notes && (
          <View style={styles.notesBlock} wrap={false}>
            <Text style={styles.notesLabel}>Notes</Text>
            <Text style={styles.notesText}>{data.notes}</Text>
          </View>
        )}

        {/* Paiement */}
        <View style={styles.paymentBlock} wrap={false}>
          <Text style={styles.paymentTitle}>Conditions de paiement</Text>
          <Text style={styles.paymentLine}>
            Paiement sous {Math.max(0, Math.round((new Date(data.dateEcheance).getTime() - new Date(data.dateEmission).getTime()) / 86400000))} jours.
          </Text>
          <Text style={styles.paymentLine}>
            Versement sur le compte {VENDOR.iban}{VENDOR.bank ? ' (' + VENDOR.bank + ')' : ''}.
          </Text>
          <Text style={styles.paymentLine}>
            Communication : <Text style={{ fontFamily: 'Courier' }}>{data.numero}</Text>
          </Text>
        </View>

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text>{VENDOR.name} · BCE {VENDOR.bce} · TVA {VENDOR.vat}</Text>
          <Text>Facture {data.numero}</Text>
        </View>
      </Page>
    </Document>
  );
}
