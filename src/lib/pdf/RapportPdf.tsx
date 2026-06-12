import path from 'node:path';
import fs from 'node:fs';
import {
  Document, Page, Text, View, Image, Font, StyleSheet,
} from '@react-pdf/renderer';
import type { ReportData } from '@/lib/rapport/build-docx';
import type { RapportPhotoData, RapportPhotosBySection } from '@/lib/rapport/photos';
import { RAPPORT_TECHNIQUES } from '@/lib/rapport/techniques';

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

// Logos (PNG alpha, public/) : blanc pour la couverture, couleur pour le
// header des pages de contenu. Lus une fois au chargement du module,
// best-effort : sans fichier, repli sur le logo JPG historique (prop) puis
// sur le wordmark « FoxO » en Syne. Inclus dans le bundle serveur via
// next.config (outputFileTracingIncludes).
function readAsset(rel: string): Buffer | null {
  try {
    return fs.readFileSync(path.join(process.cwd(), ...rel.split('/')));
  } catch (e) {
    console.warn(`[rapport/pdf] asset introuvable (${rel}):`, e);
    return null;
  }
}
const COVER_LOGO = readAsset('public/foxo-logo-blanc-transparent.png');
// Logo carré couleur (1024×1024) pour le header — préféré à
// foxo-logo-documents.png et au JPG historique, qui embarquent tous deux un
// bloc de coordonnées illisible à cette taille (doublon avec le bloc de
// droite du header).
const HEADER_LOGO = readAsset('public/foxo-logo-transparent.png');
const HEADER_LOGO_W = 52;
const HEADER_LOGO_H = 52;

// Coordonnées société — uniques sources des textes du footer et de la
// couverture (mêmes valeurs que l'historique).
const SOCIETE = {
  ligne1: 'Fox Group srl  ·  Stationstraat 55, 3070 Kortenberg  ·  info@foxo.be  ·  +32 488 700 007',
  ligne2: 'TVA : BE1030.109.019  ·  BEOBANK : BE62 9502 6652 9861',
  ligne3: '© 2026 Fox Group srl – Tous droits réservés – Rapport technique – Modèle propriétaire – Reproduction interdite',
};

// ── Couverture ── pleine page marine, logo blanc, carte d'identification.
const cover = StyleSheet.create({
  page: {
    fontFamily: 'Inter',
    color: C.cream,
    backgroundColor: C.navy,
    paddingHorizontal: 56,
    paddingTop: 96,
    paddingBottom: 40,
  },
  logoZone: { alignItems: 'center', marginBottom: 64 },
  logo: { width: 140, height: 140 },
  logoFallback: { fontFamily: 'Syne', fontWeight: 'bold', fontSize: 44, color: C.cream },
  title: {
    fontFamily: 'Syne', fontWeight: 'bold',
    fontSize: 28,
    letterSpacing: 4,
    textAlign: 'center',
    color: '#FFFFFF',
  },
  titleRule: {
    width: 60, height: 2,
    backgroundColor: C.amber,
    alignSelf: 'center',
    marginTop: 18,
  },
  // Carte d'identification (tiers bas).
  card: {
    marginTop: 'auto',
    backgroundColor: C.cream,
    borderRadius: 6,
    paddingVertical: 22,
    paddingHorizontal: 26,
  },
  cardRow: { marginBottom: 11 },
  cardRowLast: { marginBottom: 0 },
  cardCols: { flexDirection: 'row' },
  cardCol: { flex: 1 },
  label: {
    fontFamily: 'Inter', fontWeight: 600,
    fontSize: 8,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: C.amber,
    marginBottom: 2.5,
  },
  value: { fontFamily: 'Inter', fontWeight: 500, fontSize: 11.5, color: C.navy, lineHeight: 1.35 },
  footer: {
    marginTop: 28,
    textAlign: 'center',
    fontSize: 7,
    lineHeight: 1.5,
    color: '#FFFFFF',
    opacity: 0.6,
  },
});

const styles = StyleSheet.create({
  page: {
    // paddingTop réserve la zone du header (fixed, répété chaque page) ;
    // paddingBottom réserve la zone du footer + numéro de page (fixed).
    paddingTop: 96,
    paddingBottom: 64,
    paddingHorizontal: 36,
    fontFamily: 'Inter',
    fontSize: 10,
    color: C.ink,
    backgroundColor: '#FFFFFF',
  },
  // ── Header (fixed) : logo couleur à gauche, coordonnées à droite,
  // filet ambre fin en assise. ──
  header: {
    position: 'absolute',
    top: 26, left: 36, right: 36,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: 8,
  },
  headerFallback: { fontFamily: 'Syne', fontWeight: 'bold', fontSize: 20, color: C.navy },
  headerCoords: { textAlign: 'right' },
  headerSociete: { fontFamily: 'Inter', fontWeight: 600, fontSize: 8, color: C.navy, marginBottom: 1.5 },
  headerContact: { fontSize: 7, color: C.muted, lineHeight: 1.4 },
  headerRule: { height: 1, backgroundColor: C.amber },
  // ── Cartes d'identification (remplacent le tableau Word) ──
  identRow: { flexDirection: 'row', marginBottom: 8 },
  identCard: {
    backgroundColor: C.sand,
    borderRadius: 4,
    paddingVertical: 9,
    paddingHorizontal: 12,
  },
  identCol: { flex: 1 },
  identGap: { width: 8 },
  label: {
    fontFamily: 'Inter', fontWeight: 600,
    fontSize: 7.5,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: C.amber,
    marginBottom: 2,
  },
  value: { fontSize: 10, color: C.ink, lineHeight: 1.35 },
  valueStrong: { fontFamily: 'Inter', fontWeight: 600, fontSize: 10, color: C.navy, lineHeight: 1.35 },
  occLine: { fontSize: 8.5, color: C.muted, marginTop: 1.5, lineHeight: 1.3 },
  // ── Techniques (carte sable, 2 colonnes) ──
  techCols: { flexDirection: 'row', width: '100%' },
  techCol: { width: '50%' },
  checkRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 2 },
  checkOn: {
    width: 11, height: 11, borderRadius: 3,
    backgroundColor: C.navy,
    alignItems: 'center', justifyContent: 'center',
    marginRight: 5,
  },
  checkOnMark: { fontSize: 7, color: '#FFFFFF', fontFamily: 'Inter', fontWeight: 'bold' },
  checkOff: {
    width: 9, height: 9, borderWidth: 0.8, borderColor: C.muted, borderRadius: 2,
    marginRight: 6, marginLeft: 1,
  },
  checkLabel: { fontSize: 8.5, color: C.muted },
  checkLabelOn: { fontFamily: 'Inter', fontWeight: 600, color: C.navy },
  // ── Sections ── filet ambre court AU-DESSUS du titre Syne.
  sectionRule: { width: 24, height: 2, backgroundColor: C.amber, marginTop: 18, marginBottom: 6 },
  sectionTitle: {
    fontFamily: 'Syne', fontWeight: 600,
    fontSize: 13,
    color: C.navy,
    letterSpacing: 1,
    marginBottom: 8,
  },
  paragraph: { fontSize: 10, lineHeight: 1.5, color: C.ink, marginBottom: 6 },
  empty: { fontSize: 9.5, color: C.muted },
  // ── Photos (grille 2 colonnes, max 2 par ligne — règle métier) ──
  photosGrid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 6, marginBottom: 2 },
  photoCell: { width: '50%', paddingHorizontal: 4, marginBottom: 8, alignItems: 'center' },
  photoCaption: {
    fontFamily: 'Inter', fontStyle: 'italic',
    fontSize: 8, color: C.muted, textAlign: 'center', marginTop: 3,
  },
  // ── Clôture ──
  closing: { marginTop: 28, alignItems: 'flex-end' },
  faitA: { fontSize: 10.5, color: C.muted },
  faitADate: { fontFamily: 'Inter', fontWeight: 600, color: C.navy },
  closingSociete: { fontFamily: 'Syne', fontWeight: 600, fontSize: 10, color: C.navy, marginTop: 4 },
  closingTech: { fontSize: 9, color: C.muted, marginTop: 3 },
  // ── Footer (fixed) : 3 lignes + numéro de page ──
  footer: {
    position: 'absolute',
    left: 36, right: 36, bottom: 22,
    textAlign: 'center',
    fontSize: 6.5, color: C.muted, lineHeight: 1.5,
    borderTopWidth: 0.75, borderTopColor: C.sandBorder,
    paddingTop: 6,
  },
  footerDot: { color: C.amber },
  pageNumber: {
    position: 'absolute',
    right: 36, bottom: 22,
    fontSize: 7, color: C.muted,
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
      {checked
        ? <View style={styles.checkOn}><Text style={styles.checkOnMark}>✓</Text></View>
        : <View style={styles.checkOff} />}
      <Text style={[styles.checkLabel, checked ? styles.checkLabelOn : {}]}>{label}</Text>
    </View>
  );
}

function Section({ title, text }: { title: string; text: string }) {
  const paras = paragraphs(text);
  return (
    <View>
      {/* Filet + titre insécables avec la 1re ligne du corps (minPresenceAhead) :
          jamais de titre orphelin en bas de page. */}
      <View minPresenceAhead={40}>
        <View style={styles.sectionRule} />
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      {paras.length > 0
        ? paras.map((p, i) => <Text key={i} style={styles.paragraph}>{p}</Text>)
        : <Text style={styles.empty}>—</Text>}
    </View>
  );
}

// Ligne de footer : les « · » de séparation passent en ambre (micro-signature
// FoxO), le reste reste muted.
function FooterLine({ text }: { text: string }) {
  const parts = text.split('·');
  return (
    <Text>
      {parts.map((part, i) => (
        <Text key={i}>
          {i > 0 && <Text style={styles.footerDot}>·</Text>}
          {part}
        </Text>
      ))}
    </Text>
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
      {/* ── Couverture ── aucun élément fixed de la page de contenu ici :
          les fixed sont scopés à leur <Page>. */}
      <Page size="A4" style={cover.page}>
        <View style={cover.logoZone}>
          {COVER_LOGO
            ? <Image src={{ data: COVER_LOGO, format: 'png' }} style={cover.logo} />
            : <Text style={cover.logoFallback}>FoxO</Text>}
        </View>

        <Text style={cover.title}>RAPPORT</Text>
        <Text style={cover.title}>D{'’'}INTERVENTION</Text>
        <View style={cover.titleRule} />

        <View style={cover.card}>
          <View style={[cover.cardCols, cover.cardRow]}>
            <View style={cover.cardCol}>
              <Text style={cover.label}>N° intervention</Text>
              <Text style={cover.value}>{data.numero || '—'}</Text>
            </View>
            <View style={cover.cardCol}>
              <Text style={cover.label}>{data.ref_label.replace(/\s*:\s*$/, '')}</Text>
              <Text style={cover.value}>{data.ref_value || '—'}</Text>
            </View>
          </View>
          <View style={cover.cardRow}>
            <Text style={cover.label}>Objet</Text>
            <Text style={cover.value}>{data.objet || '—'}</Text>
          </View>
          <View style={cover.cardRow}>
            <Text style={cover.label}>Adresse d&apos;intervention</Text>
            <Text style={cover.value}>{data.adresse_ligne1 || '—'}</Text>
          </View>
          <View style={cover.cardRowLast}>
            <Text style={cover.label}>Client</Text>
            <Text style={cover.value}>{facturationLines[0] ?? '—'}</Text>
          </View>
        </View>

        <View style={cover.footer}>
          <Text>{SOCIETE.ligne1}</Text>
          <Text>{SOCIETE.ligne2}</Text>
        </View>
      </Page>

      <Page size="A4" style={styles.page}>
        {/* ── Header (répété chaque page) ── */}
        <View style={styles.header} fixed>
          <View style={styles.headerRow}>
            {HEADER_LOGO
              ? <Image src={{ data: HEADER_LOGO, format: 'png' }} style={{ width: HEADER_LOGO_W, height: HEADER_LOGO_H }} />
              : logo
                ? <Image src={{ data: logo, format: 'jpg' }} style={{ width: HEADER_LOGO_W, height: Math.round(HEADER_LOGO_W / 1.9) }} />
                : <Text style={styles.headerFallback}>FoxO</Text>}
            <View style={styles.headerCoords}>
              <Text style={styles.headerSociete}>Fox Group srl</Text>
              <Text style={styles.headerContact}>Stationstraat 55, 3070 Kortenberg</Text>
              <Text style={styles.headerContact}>info@foxo.be  ·  +32 488 700 007</Text>
            </View>
          </View>
          <View style={styles.headerRule} />
        </View>

        {/* ── Identification en cartes ── */}
        <View style={styles.identRow}>
          <View style={[styles.identCard, { width: '34%' }]}>
            <View style={{ marginBottom: 7 }}>
              <Text style={styles.label}>N° intervention</Text>
              <Text style={styles.valueStrong}>{data.numero || '—'}</Text>
            </View>
            <View>
              <Text style={styles.label}>{data.ref_label.replace(/\s*:\s*$/, '')}</Text>
              <Text style={styles.valueStrong}>{data.ref_value || '—'}</Text>
            </View>
          </View>
          <View style={styles.identGap} />
          <View style={[styles.identCard, { flex: 1 }]}>
            <Text style={styles.label}>Objet de l{'’'}intervention</Text>
            <Text style={styles.value}>{data.objet || '—'}</Text>
          </View>
        </View>

        <View style={styles.identRow}>
          <View style={[styles.identCard, styles.identCol]}>
            <Text style={styles.label}>Adresse d{'’'}intervention</Text>
            <Text style={styles.value}>{data.adresse_ligne1 || '—'}</Text>
            {occupantLines.map((l, i) => <Text key={i} style={styles.occLine}>{l}</Text>)}
            {data.adresse_ligne3 ? <Text style={styles.occLine}>{data.adresse_ligne3}</Text> : null}
          </View>
          <View style={styles.identGap} />
          <View style={[styles.identCard, styles.identCol]}>
            <Text style={styles.label}>Adresse de facturation</Text>
            {facturationLines.length > 0
              ? facturationLines.map((l, i) => <Text key={i} style={styles.value}>{l}</Text>)
              : <Text style={styles.value}>—</Text>}
          </View>
        </View>

        {/* ── Techniques d'inspection ── */}
        <View style={styles.identCard}>
          <Text style={[styles.label, { marginBottom: 5 }]}>Techniques d{'’'}inspection</Text>
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

        {/* ── 4 sections ── Photos en fin de DÉGÂTS et d'INSPECTION uniquement. */}
        <Section title="DÉGÂTS" text={data.degats} />
        <PhotosGrid photos={photos.degats} />
        <Section title="INSPECTION" text={data.inspection} />
        <PhotosGrid photos={photos.inspection} />
        <Section title="CONCLUSION" text={data.conclusion} />
        <Section title="RECOMMANDATION" text={data.recommandation} />

        {/* ── Clôture ── */}
        <View style={styles.closing} wrap={false}>
          <Text style={styles.faitA}>
            Fait à Bruxelles, le <Text style={styles.faitADate}>{data.fait_a_date}</Text>
          </Text>
          <Text style={styles.closingSociete}>Fox Group srl</Text>
          {data.technicien_nom
            ? <Text style={styles.closingTech}>Technicien : {data.technicien_nom}</Text>
            : null}
        </View>

        {/* ── Footer 3 lignes + numéro de page (répétés chaque page) ── */}
        <View style={styles.footer} fixed>
          <FooterLine text={SOCIETE.ligne1} />
          <FooterLine text={SOCIETE.ligne2} />
          <Text>{SOCIETE.ligne3}</Text>
        </View>
        <Text
          style={styles.pageNumber}
          render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
          fixed
        />
      </Page>
    </Document>
  );
}
