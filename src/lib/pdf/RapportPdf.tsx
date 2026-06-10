import path from 'node:path';
import {
  Document, Page, Text, View, Image, Font, StyleSheet,
} from '@react-pdf/renderer';
import type { ReportData } from '@/lib/rapport/build-docx';
import { RAPPORT_TECHNIQUES } from '@/lib/rapport/techniques';
import { RAPPORT_LOGO } from '@/lib/rapport/logo';

// Police Carlito — jumelle métrique de Calibri (licence SIL OFL, embarquable).
// Les .ttf sont commités dans src/lib/pdf/fonts/ (+ OFL.txt) et inclus dans le
// bundle serveur via next.config (outputFileTracingIncludes). Enregistrée une
// seule fois au chargement du module.
const FONTS_DIR = path.join(process.cwd(), 'src', 'lib', 'pdf', 'fonts');
Font.register({
  family: 'Carlito',
  fonts: [
    { src: path.join(FONTS_DIR, 'Carlito-Regular.ttf') },
    { src: path.join(FONTS_DIR, 'Carlito-Bold.ttf'), fontWeight: 'bold' },
    { src: path.join(FONTS_DIR, 'Carlito-Italic.ttf'), fontStyle: 'italic' },
    { src: path.join(FONTS_DIR, 'Carlito-BoldItalic.ttf'), fontWeight: 'bold', fontStyle: 'italic' },
  ],
});

// Moteur PDF du rapport — JUMEAU STRUCTUREL du template Word
// (templates/"FOXO TEMPLATE VIERGE.docx") et du moteur docx (build-docx.ts).
// Consomme le MÊME objet ReportData. Police : Carlito (jumelle Calibri),
// embarquée depuis src/lib/pdf/fonts/.
//
// Palette alignée sur build-docx.ts.
const C = {
  dark: '#1B3A5C',     // titres, encadré, labels
  mid: '#2E75B6',      // cases non cochées
  accent: '#4A9FD4',   // ligne sous les titres de section
  light: '#EAF4FB',    // fond cellules labels
  body: '#1A1A1A',     // texte courant
  muted: '#6B6B6B',    // secondaire / occupants / footer
  divider: '#C0D4E8',  // bordures tableau
};

// Largeurs du tableau d'identification (mêmes proportions que le docx :
// C1=1900, C2=3333, C3=1900, C4=3333 — total 10466).
const W = {
  c1: '18.16%',
  c2: '31.84%',
  c3: '18.16%',
  c4: '31.84%',
  c1c2: '50%',
  c3c4: '50%',
  c2c3c4: '81.84%',
};

const styles = StyleSheet.create({
  page: {
    // paddingTop réserve la zone du header logo (fixed, répété chaque page) ;
    // paddingBottom réserve la zone du footer (fixed).
    paddingTop: 126,
    paddingBottom: 58,
    paddingHorizontal: 30,
    fontFamily: 'Carlito',
    fontSize: 10,
    color: C.body,
    backgroundColor: '#FFFFFF',
  },
  // Encadré pleine page (4 côtés), répété sur chaque page.
  pageBorder: {
    position: 'absolute',
    top: 18, left: 18, right: 18, bottom: 18,
    borderWidth: 1.2,
    borderColor: C.dark,
  },
  // Header logo (aligné gauche comme dans word/header1.xml du template),
  // répété sur chaque page (fixed). Séparateur dark sous le logo.
  logoHeader: {
    position: 'absolute',
    top: 28, left: 30, right: 30,
  },
  logoSep: {
    marginTop: 6,
    borderBottomWidth: 1,
    borderBottomColor: C.dark,
  },
  logoFallback: { fontFamily: 'Carlito', fontWeight: 'bold', fontSize: 24, color: C.dark },
  title: {
    textAlign: 'center',
    fontFamily: 'Carlito', fontWeight: 'bold',
    fontSize: 22,
    color: C.dark,
    letterSpacing: 1,
    marginBottom: 14,
  },
  // ── Tableau d'identification ──
  table: { width: '100%', borderTopWidth: 0.6, borderLeftWidth: 0.6, borderColor: C.divider },
  row: { flexDirection: 'row' },
  cellLabel: {
    backgroundColor: C.light,
    borderRightWidth: 0.6, borderBottomWidth: 0.6, borderColor: C.divider,
    paddingVertical: 4, paddingHorizontal: 5,
    fontFamily: 'Carlito', fontWeight: 'bold', color: C.dark, fontSize: 8.5,
  },
  cellValue: {
    borderRightWidth: 0.6, borderBottomWidth: 0.6, borderColor: C.divider,
    paddingVertical: 4, paddingHorizontal: 5,
    fontSize: 9.5, color: C.body,
  },
  facLine: { fontSize: 9.5, color: C.body, marginBottom: 1 },
  occLine: { fontSize: 8.5, color: C.muted, marginTop: 1 },
  // ── Techniques (cases dessinées) ──
  techCols: { flexDirection: 'row', width: '100%' },
  techCol: { width: '50%' },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', marginVertical: 1.5 },
  checkbox: {
    width: 9, height: 9, borderWidth: 0.8,
    alignItems: 'center', justifyContent: 'center',
    marginRight: 4, marginTop: 0.5,
  },
  checkboxInner: { width: 4.5, height: 4.5 },
  checkLabel: { fontSize: 8.5, color: C.body },
  checkLabelOn: { fontFamily: 'Carlito', fontWeight: 'bold', color: C.dark },
  // ── Sections ──
  sectionTitle: {
    fontFamily: 'Carlito', fontWeight: 'bold',
    fontSize: 12,
    color: C.dark,
    letterSpacing: 0.5,
    marginTop: 14, marginBottom: 4,
    paddingBottom: 3,
    borderBottomWidth: 1, borderBottomColor: C.accent,
  },
  paragraph: { fontSize: 10, lineHeight: 1.5, color: C.body, marginBottom: 4 },
  empty: { fontSize: 9.5, color: C.muted },
  // ── Clôture ──
  faitA: { textAlign: 'right', marginTop: 26, fontSize: 11, color: C.muted },
  faitADate: { fontFamily: 'Carlito', fontWeight: 'bold', color: C.dark },
  // ── Footer 3 lignes ──
  footer: {
    position: 'absolute',
    left: 30, right: 30, bottom: 24,
    textAlign: 'center',
    fontSize: 7, color: C.muted, lineHeight: 1.45,
    borderTopWidth: 0.5, borderTopColor: C.divider,
    paddingTop: 5,
  },
});

// Découpe une section sur le séparateur '||PARA||' (cf. textToParas docx).
function paragraphs(text: string): string[] {
  return (text ?? '')
    .split('||PARA||')
    .map((s) => s.trim())
    .filter(Boolean);
}

function CheckItem({ label, checked }: { label: string; checked: boolean }) {
  return (
    <View style={styles.checkRow} wrap={false}>
      <View style={[styles.checkbox, { borderColor: checked ? C.dark : C.mid }]}>
        {checked && <View style={[styles.checkboxInner, { backgroundColor: C.dark }]} />}
      </View>
      <Text style={[styles.checkLabel, checked ? styles.checkLabelOn : {}]}>{label}</Text>
    </View>
  );
}

function Section({ title, text }: { title: string; text: string }) {
  const paras = paragraphs(text);
  return (
    <View>
      <Text style={styles.sectionTitle}>{title}</Text>
      {paras.length > 0
        ? paras.map((p, i) => <Text key={i} style={styles.paragraph}>{p}</Text>)
        : <Text style={styles.empty}>—</Text>}
    </View>
  );
}

export function RapportPdf({ data, logo }: { data: ReportData; logo?: Buffer | null }) {
  const facturationLines = [
    data.facturation_ligne1,
    data.facturation_ligne2,
    data.facturation_ligne3,
    data.facturation_ligne4,
  ].map((l) => (l ?? '').trim()).filter(Boolean);

  const occupantLines = (data.adresse_ligne2 ?? '')
    .split('\n').map((s) => s.trim()).filter(Boolean);

  const techLeft = RAPPORT_TECHNIQUES.slice(0, 4);
  const techRight = RAPPORT_TECHNIQUES.slice(4, 8);

  return (
    <Document
      title={`Rapport ${data.numero}`}
      author="Fox Group srl"
      subject="Rapport d'intervention — détection de fuites"
    >
      <Page size="A4" style={styles.page}>
        {/* Encadré pleine page, répété sur chaque page */}
        <View style={styles.pageBorder} fixed />

        {/* Header logo (gauche, répété chaque page), comme dans le template */}
        <View style={styles.logoHeader} fixed>
          {logo
            ? <Image src={{ data: logo, format: 'jpg' }} style={{ width: RAPPORT_LOGO.widthPt, height: RAPPORT_LOGO.heightPt }} />
            : <Text style={styles.logoFallback}>FoxO</Text>}
          <View style={styles.logoSep} />
        </View>

        <Text style={styles.title}>RAPPORT D&apos;INTERVENTION</Text>

        {/* ── Tableau d'identification ── */}
        <View style={styles.table}>
          {/* L1 : N° Intervention : | numero | ref_label | ref_value */}
          <View style={styles.row}>
            <Text style={[styles.cellLabel, { width: W.c1 }]}>N° Intervention :</Text>
            <Text style={[styles.cellValue, { width: W.c2 }]}>{data.numero || '—'}</Text>
            <Text style={[styles.cellLabel, { width: W.c3 }]}>{data.ref_label}</Text>
            <Text style={[styles.cellValue, { width: W.c4 }]}>{data.ref_value || '—'}</Text>
          </View>
          {/* L2 : Objet intervention : | Adresse Facturation : */}
          <View style={styles.row}>
            <Text style={[styles.cellLabel, { width: W.c1c2 }]}>Objet intervention :</Text>
            <Text style={[styles.cellLabel, { width: W.c3c4 }]}>Adresse Facturation :</Text>
          </View>
          {/* L3 : objet | facturation (multi-lignes) */}
          <View style={styles.row}>
            <Text style={[styles.cellValue, { width: W.c1c2 }]}>{data.objet || '—'}</Text>
            <View style={[styles.cellValue, { width: W.c3c4 }]}>
              {facturationLines.length > 0
                ? facturationLines.map((l, i) => <Text key={i} style={styles.facLine}>{l}</Text>)
                : <Text style={styles.facLine}>—</Text>}
            </View>
          </View>
          {/* L4 : Adresse d'intervention : | adresse + occupants (1 ligne/occupant) */}
          <View style={styles.row}>
            <Text style={[styles.cellLabel, { width: W.c1 }]}>Adresse d&apos;intervention :</Text>
            <View style={[styles.cellValue, { width: W.c2c3c4 }]}>
              <Text style={styles.facLine}>{data.adresse_ligne1 || '—'}</Text>
              {occupantLines.map((l, i) => <Text key={i} style={styles.occLine}>{l}</Text>)}
              {data.adresse_ligne3 ? <Text style={styles.occLine}>{data.adresse_ligne3}</Text> : null}
            </View>
          </View>
          {/* L5 : Techniques d'inspection : | 4 gauche | 4 droite */}
          <View style={styles.row}>
            <Text style={[styles.cellLabel, { width: W.c1 }]}>Techniques d&apos;inspection :</Text>
            <View style={[styles.cellValue, { width: W.c2c3c4 }]}>
              <View style={styles.techCols}>
                <View style={styles.techCol}>
                  {techLeft.map((tk) => (
                    <CheckItem key={tk.key} label={tk.label} checked={Boolean(data.techniques[tk.key])} />
                  ))}
                </View>
                <View style={styles.techCol}>
                  {techRight.map((tk) => (
                    <CheckItem key={tk.key} label={tk.label} checked={Boolean(data.techniques[tk.key])} />
                  ))}
                </View>
              </View>
            </View>
          </View>
        </View>

        {/* ── 4 sections ── */}
        <Section title="DÉGÂTS" text={data.degats} />
        <Section title="INSPECTION" text={data.inspection} />
        <Section title="CONCLUSION" text={data.conclusion} />
        <Section title="RECOMMANDATION" text={data.recommandation} />

        {/* ── Clôture ── */}
        <Text style={styles.faitA}>
          Fait à Bruxelles le,  <Text style={styles.faitADate}>{data.fait_a_date}</Text>
        </Text>

        {/* ── Footer 3 lignes, répété sur chaque page ── */}
        <View style={styles.footer} fixed>
          <Text>Fox Group srl  ·  Stationstraat 55, 3070 Kortenberg  ·  info@foxo.be  ·  +32 488 700 007</Text>
          <Text>TVA : BE1030.109.019  ·  BEOBANK : BE62 9502 6652 9861</Text>
          <Text>© 2026 Fox Group srl – Tous droits réservés – Rapport technique – Modèle propriétaire – Reproduction interdite</Text>
        </View>
      </Page>
    </Document>
  );
}
