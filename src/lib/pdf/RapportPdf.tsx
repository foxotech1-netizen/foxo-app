import {
  Document, Page, Text, View, StyleSheet,
} from '@react-pdf/renderer';

export type RapportPdfData = {
  ref: string;
  acpNom: string;
  acpAdresse: string;
  type: string;
  description: string;
  priorite: 'normale' | 'urgente';
  creneauDebut: string | null;
  startedAt: string | null;
  endedAt: string | null;
  syndicNom: string | null;
  technicienNom: string | null;
  rapport: {
    degats: string;
    inspection: string;
    conclusion: string;
    recommandations: string;
  };
  generatedAt: string;
};

const COLORS = {
  navy: '#1B3A6B',
  ink: '#1C1A16',
  inkMid: '#6B6558',
  inkMuted: '#A09A8E',
  border: '#DDD8CC',
  cream: '#FDFBF7',
  sand: '#F5F2EC',
  terra: '#C4622D',
};

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontFamily: 'Helvetica',
    fontSize: 10,
    color: COLORS.ink,
    backgroundColor: '#FFFFFF',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.navy,
    marginBottom: 18,
  },
  brand: { fontSize: 22, fontWeight: 700, color: COLORS.navy, letterSpacing: 1 },
  brandSub: { fontSize: 8, color: COLORS.inkMuted, marginTop: 2, letterSpacing: 1, textTransform: 'uppercase' },
  refBlock: { textAlign: 'right' },
  refLabel: { fontSize: 8, color: COLORS.inkMuted, letterSpacing: 1, textTransform: 'uppercase' },
  ref: { fontSize: 12, fontFamily: 'Courier', color: COLORS.navy, marginTop: 2 },
  reportDate: { fontSize: 8, color: COLORS.inkMuted, marginTop: 4 },
  title: { fontSize: 16, fontWeight: 700, color: COLORS.ink, marginBottom: 4 },
  subtitle: { fontSize: 10, color: COLORS.inkMid, marginBottom: 16 },
  metaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    backgroundColor: COLORS.cream,
    border: 1,
    borderColor: COLORS.border,
    borderRadius: 4,
    padding: 12,
    marginBottom: 18,
  },
  metaCell: { width: '50%', paddingVertical: 4, paddingRight: 8 },
  metaLabel: { fontSize: 7, color: COLORS.inkMuted, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 2 },
  metaValue: { fontSize: 10, color: COLORS.ink },
  urgentTag: {
    color: '#FFFFFF',
    backgroundColor: COLORS.terra,
    fontSize: 7,
    fontWeight: 700,
    padding: '2 6',
    marginLeft: 6,
    borderRadius: 8,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: 700,
    color: COLORS.navy,
    marginTop: 14,
    marginBottom: 6,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  paragraph: { fontSize: 10, lineHeight: 1.55, color: COLORS.ink, marginBottom: 4 },
  empty: { fontSize: 9, color: COLORS.inkMuted, fontStyle: 'italic' },
  footer: {
    position: 'absolute',
    bottom: 28,
    left: 40,
    right: 40,
    fontSize: 8,
    color: COLORS.inkMuted,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 6,
    borderTopWidth: 0.5,
    borderTopColor: COLORS.border,
  },
});

function fmt(iso: string | null, withTime = true): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('fr-BE', {
    day: 'numeric', month: 'long', year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

function durationText(start: string | null, end: string | null): string {
  if (!start || !end) return '—';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms <= 0) return '—';
  const min = Math.round(ms / 60000);
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}` : `${m} min`;
}

export function RapportPdf({ data }: { data: RapportPdfData }) {
  const sections: Array<[string, string]> = [
    ['Dégâts', data.rapport.degats],
    ['Inspection', data.rapport.inspection],
    ['Conclusion', data.rapport.conclusion],
    ['Recommandations', data.rapport.recommandations],
  ];

  return (
    <Document
      title={`Rapport intervention ${data.ref}`}
      author="FoxO — Fox Group SRL"
      subject="Rapport d'intervention détection de fuites"
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>FoxO</Text>
            <Text style={styles.brandSub}>Détection de fuites — Belgique</Text>
          </View>
          <View style={styles.refBlock}>
            <Text style={styles.refLabel}>Référence</Text>
            <Text style={styles.ref}>{data.ref}</Text>
            <Text style={styles.reportDate}>Émis le {fmt(data.generatedAt)}</Text>
          </View>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
          <Text style={styles.title}>{data.acpNom}</Text>
          {data.priorite === 'urgente' && (
            <Text style={styles.urgentTag}>URGENT</Text>
          )}
        </View>
        <Text style={styles.subtitle}>{data.acpAdresse}</Text>

        <View style={styles.metaGrid}>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Demandeur</Text>
            <Text style={styles.metaValue}>{data.syndicNom ?? '—'}</Text>
          </View>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Technicien</Text>
            <Text style={styles.metaValue}>{data.technicienNom ?? '—'}</Text>
          </View>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Type d&apos;intervention</Text>
            <Text style={styles.metaValue}>{data.type}</Text>
          </View>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Créneau</Text>
            <Text style={styles.metaValue}>{fmt(data.creneauDebut)}</Text>
          </View>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Début effectif</Text>
            <Text style={styles.metaValue}>{fmt(data.startedAt)}</Text>
          </View>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Durée sur place</Text>
            <Text style={styles.metaValue}>{durationText(data.startedAt, data.endedAt)}</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Description initiale</Text>
        <Text style={data.description ? styles.paragraph : styles.empty}>
          {data.description || 'Aucune description fournie.'}
        </Text>

        {sections.map(([title, content]) => (
          <View key={title} wrap={false}>
            <Text style={styles.sectionTitle}>{title}</Text>
            <Text style={content ? styles.paragraph : styles.empty}>
              {content || '—'}
            </Text>
          </View>
        ))}

        <View style={styles.footer}>
          <Text>Fox Group SRL · noreply@foxo.be</Text>
          <Text>Rapport {data.ref}</Text>
        </View>
      </Page>
    </Document>
  );
}
