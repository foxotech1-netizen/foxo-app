import path from 'node:path';
import {
  Document, Page, Text, View, Image, Font, StyleSheet,
} from '@react-pdf/renderer';
import type { ReportData } from '@/lib/rapport/build-docx';
import type { RapportPhotoData, RapportPhotosBySection } from '@/lib/rapport/photos';
import { RAPPORT_TECHNIQUES } from '@/lib/rapport/techniques';
import { RAPPORT_LOGO } from '@/lib/rapport/logo';

// Typographie FoxO (alignée sur le design system web, cf. CLAUDE.md) :
// Syne pour le display/titres, Inter pour le corps. @react-pdf exige des TTF
// STATIQUES : Inter est extrait du TTC officiel (release rsms/inter v4.1),
// Syne instancié depuis la variable google/fonts (fonttools varLib.instancer,
// wght 600/700). Licences SIL OFL (OFL-Inter.txt / OFL-Syne.txt). Les .ttf
// sont commités dans src/lib/pdf/fonts/ et inclus dans le bundle serveur via
// next.config (outputFileTracingIncludes). Enregistrés une seule fois au
// chargement du module.
const FONTS_DIR = path.join(process.cwd(), 'src', 'lib', 'pdf', 'fonts');
Font.register({
  family: 'Inter',
  fonts: [
    { src: path.join(FONTS_DIR, 'Inter-Regular.ttf') },
    { src: path.join(FONTS_DIR, 'Inter-Medium.ttf'), fontWeight: 500 },
    { src: path.join(FONTS_DIR, 'Inter-SemiBold.ttf'), fontWeight: 600 },
    { src: path.join(FONTS_DIR, 'Inter-Bold.ttf'), fontWeight: 'bold' },
    { src: path.join(FONTS_DIR, 'Inter-Italic.ttf'), fontStyle: 'italic' },
  ],
});
Font.register({
  family: 'Syne',
  fonts: [
    { src: path.join(FONTS_DIR, 'Syne-SemiBold.ttf'), fontWeight: 600 },
    { src: path.join(FONTS_DIR, 'Syne-Bold.ttf'), fontWeight: 'bold' },
  ],
});
// Pas de césure automatique : l'algorithme par défaut coupe les mots
// français n'importe où (« interven-tion ») — on préfère le retour à la
// ligne au mot entier.
Font.registerHyphenationCallback((w) => [w]);

// Moteur PDF du rapport syndic — RÉFÉRENCE VISUELLE CLIENT (identité FoxO).
// Consomme le MÊME ReportData que le moteur docx (build-docx.ts), qui reste
// le document de travail interne au gabarit Word historique.
//
// Palette — source : tokens @theme de src/app/globals.css (le PDF ne lit pas
// le CSS : valeurs recopiées, à maintenir en phase avec globals.css).
const C = {
  navy: '#1B3A6B',       // --color-navy : titres, éléments forts
  navyDark: '#152D54',   // --color-navy-dark : fonds profonds (couverture)
  amber: '#B8830A',      // --color-amber-foxo : accent unique (filets, labels)
  sand: '#F5F2EC',       // --color-sand : fonds de cartes
  sandBorder: '#DDD8CC', // --color-sand-border : bordures discrètes
  cream: '#FDFBF7',      // --color-cream : carte sur fond marine
  ink: '#1A1A1A',        // texte courant
  muted: '#6B6B6B',      // secondaire / légendes / footer
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
    fontFamily: 'Inter',
    fontSize: 10,
    color: C.ink,
    backgroundColor: '#FFFFFF',
  },
  // Encadré pleine page (4 côtés), répété sur chaque page.
  pageBorder: {
    position: 'absolute',
    top: 18, left: 18, right: 18, bottom: 18,
    borderWidth: 1.2,
    borderColor: C.navy,
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
    borderBottomColor: C.navy,
  },
  logoFallback: { fontFamily: 'Syne', fontWeight: 'bold', fontSize: 24, color: C.navy },
  title: {
    textAlign: 'center',
    fontFamily: 'Syne', fontWeight: 'bold',
    fontSize: 22,
    color: C.navy,
    letterSpacing: 1,
    marginBottom: 14,
  },
  // ── Tableau d'identification ──
  table: { width: '100%', borderTopWidth: 0.6, borderLeftWidth: 0.6, borderColor: C.sandBorder },
  row: { flexDirection: 'row' },
  cellLabel: {
    backgroundColor: C.sand,
    borderRightWidth: 0.6, borderBottomWidth: 0.6, borderColor: C.sandBorder,
    paddingVertical: 4, paddingHorizontal: 5,
    fontFamily: 'Inter', fontWeight: 600, color: C.navy, fontSize: 8.5,
  },
  cellValue: {
    borderRightWidth: 0.6, borderBottomWidth: 0.6, borderColor: C.sandBorder,
    paddingVertical: 4, paddingHorizontal: 5,
    fontSize: 9.5, color: C.ink,
  },
  facLine: { fontSize: 9.5, color: C.ink, marginBottom: 1 },
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
  checkLabel: { fontSize: 8.5, color: C.ink },
  checkLabelOn: { fontFamily: 'Inter', fontWeight: 600, color: C.navy },
  // ── Sections ──
  sectionTitle: {
    fontFamily: 'Syne', fontWeight: 600,
    fontSize: 12,
    color: C.navy,
    letterSpacing: 0.5,
    marginTop: 14, marginBottom: 4,
    paddingBottom: 3,
    borderBottomWidth: 1, borderBottomColor: C.amber,
  },
  paragraph: { fontSize: 10, lineHeight: 1.5, color: C.ink, marginBottom: 4 },
  empty: { fontSize: 9.5, color: C.muted },
  // ── Photos (grille 2 colonnes, jumelle du moteur docx) ──
  photosGrid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 6, marginBottom: 2 },
  photoCell: { width: '50%', paddingHorizontal: 4, marginBottom: 8, alignItems: 'center' },
  photoCaption: {
    fontFamily: 'Inter', fontStyle: 'italic',
    fontSize: 8, color: C.muted, textAlign: 'center', marginTop: 3,
  },
  // ── Clôture ──
  faitA: { textAlign: 'right', marginTop: 26, fontSize: 11, color: C.muted },
  faitADate: { fontFamily: 'Inter', fontWeight: 600, color: C.navy },
  // ── Footer 3 lignes ──
  footer: {
    position: 'absolute',
    left: 30, right: 30, bottom: 24,
    textAlign: 'center',
    fontSize: 7, color: C.muted, lineHeight: 1.45,
    borderTopWidth: 0.5, borderTopColor: C.sandBorder,
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
      <View style={[styles.checkbox, { borderColor: checked ? C.navy : C.muted }]}>
        {checked && <View style={[styles.checkboxInner, { backgroundColor: C.navy }]} />}
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

// Largeur utile A4 (595.28pt) − paddingHorizontal (2×30) = 535.28pt ; chaque
// cellule occupe 50% (− padding interne). Hauteur dérivée du ratio intrinsèque
// (préservé) ; plafonnée pour qu'un cliché portrait ne dévore pas la page.
const PHOTO_COL_W = 255; // pt (≈ moitié de la largeur utile, marge comprise)
const PHOTO_MAX_H = 330; // pt

function photoDisplaySize(p: RapportPhotoData): { width: number; height: number } {
  const ratio = p.width > 0 && p.height > 0 ? p.width / p.height : 4 / 3;
  let width = PHOTO_COL_W;
  let height = width / ratio;
  if (height > PHOTO_MAX_H) {
    height = PHOTO_MAX_H;
    width = height * ratio;
  }
  return { width, height };
}

// Grille 2 colonnes (max 2 par ligne, règle métier Foxo) rendue en fin de
// section. Chaque paire image+légende est insécable (wrap={false}) → une
// légende ne se retrouve jamais seule en haut de page, détachée de son cliché.
function PhotosGrid({ photos }: { photos: RapportPhotoData[] | undefined }) {
  if (!photos || photos.length === 0) return null;
  return (
    <View style={styles.photosGrid}>
      {photos.map((p, i) => {
        const { width, height } = photoDisplaySize(p);
        return (
          <View key={i} style={styles.photoCell} wrap={false}>
            <Image src={{ data: p.bytes, format: 'jpg' }} style={{ width, height }} />
            {p.label ? <Text style={styles.photoCaption}>{p.label}</Text> : null}
          </View>
        );
      })}
    </View>
  );
}

export function RapportPdf({ data, logo, photos }: {
  data: ReportData;
  logo?: Buffer | null;
  photos: RapportPhotosBySection;
}) {
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

        {/* ── 4 sections ── Photos en fin de DÉGÂTS et d'INSPECTION uniquement. */}
        <Section title="DÉGÂTS" text={data.degats} />
        <PhotosGrid photos={photos.degats} />
        <Section title="INSPECTION" text={data.inspection} />
        <PhotosGrid photos={photos.inspection} />
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
