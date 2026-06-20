import path from 'node:path';
import fs from 'node:fs';
import {
  Document, Page, Text, View, Image, Font, StyleSheet,
} from '@react-pdf/renderer';
import type { ReportData } from '@/lib/rapport/build-docx';
import type { RapportPhotoData, RapportPhotosBySection } from '@/lib/rapport/photos';
import { RAPPORT_TECHNIQUES } from '@/lib/rapport/techniques';

// Typographie FoxO : Syne pour le display/titres, Inter pour le corps.
// @react-pdf exige des TTF STATIQUES (Inter extrait du TTC officiel rsms/inter
// v4.1, Syne instancié wght 600/700). Licences SIL OFL. Enregistrés une seule
// fois au chargement du module ; .ttf commités dans src/lib/pdf/fonts/ et
// inclus dans le bundle serveur via next.config (outputFileTracingIncludes).
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
// Pas de césure automatique (l'algorithme par défaut coupe « interven-tion »).
Font.registerHyphenationCallback((w) => [w]);

// Moteur PDF du rapport syndic — RÉFÉRENCE VISUELLE CLIENT (identité FoxO).
// Consomme le MÊME ReportData que le moteur docx (build-docx.ts), qui reste le
// document de travail interne. Les deux moteurs ne sont plus jumeaux visuels.
//
// Palette — NUANCES DE BLEU (palette propre au rapport client, VOLONTAIREMENT
// distincte de l'accent ambre de l'app web : le PDF ne lit pas globals.css).
const C = {
  title: '#0F2C54',      // bleu foncé — titres, valeurs fortes
  titleDeep: '#0A2342',  // bleu très foncé (réserve)
  accent: '#2E73B8',     // bleu accent — filets, libellés, coches
  card: '#E8F1FA',       // bleu clair — fond des cartes
  cardBorder: '#CFE0F0', // bordure discrète
  paper: '#F4F8FD',      // bleu très clair — fond de la couverture
  ink: '#16222F',        // texte courant
  muted: '#5C6B7B',      // secondaire / légendes / footer
};

// Logo couleur (PNG alpha 1024×1024, public/) : lisible sur fond clair, utilisé
// pour la couverture (grand) ET le header des pages de contenu (petit). Lu une
// fois au chargement, best-effort : sans fichier, repli sur le logo JPG
// historique (prop) puis sur le wordmark « FoxO » en Syne. Inclus dans le
// bundle serveur via next.config (outputFileTracingIncludes).
function readAsset(rel: string): Buffer | null {
  try {
    return fs.readFileSync(path.join(process.cwd(), ...rel.split('/')));
  } catch (e) {
    console.warn(`[rapport/pdf] asset introuvable (${rel}):`, e);
    return null;
  }
}
const COLOR_LOGO = readAsset('public/foxo-logo-renard.png');
const HEADER_LOGO_W = 52;
const HEADER_LOGO_H = 52;
const COVER_LOGO = 100;

// Coordonnées société — sources uniques des textes du footer et de la
// couverture (mêmes valeurs que l'historique).
const SOCIETE = {
  ville: 'Kortenberg',
  ligne1: 'Fox Group srl  ·  Stationstraat 55, 3070 Kortenberg  ·  info@foxo.be  ·  +32 488 700 007',
  ligne2: 'TVA : BE1030.109.019  ·  BEOBANK : BE62 9502 6652 9861',
  ligne3: '© 2026 Fox Group srl – Tous droits réservés – Rapport technique – Modèle propriétaire – Reproduction interdite',
};

// ── Couverture ── page CLAIRE = fiche d'identification complète (qui / où /
// quoi + techniques + L'essentiel). Les pages de contenu démarrent ensuite
// directement sur les sections (aucune répétition de l'identification).
const cover = StyleSheet.create({
  page: {
    fontFamily: 'Inter',
    color: C.ink,
    backgroundColor: C.paper,
    paddingHorizontal: 50,
    paddingTop: 46,
    paddingBottom: 34,
  },
  logoZone: { alignItems: 'center', marginBottom: 14 },
  logo: { width: 84, height: 102 },
  logoFallback: { fontFamily: 'Syne', fontWeight: 'bold', fontSize: 40, color: C.title },
  tagline: { fontSize: 8, letterSpacing: 3, textTransform: 'uppercase', color: C.accent, marginTop: 5 },
  title: {
    fontFamily: 'Syne', fontWeight: 'bold',
    fontSize: 26, letterSpacing: 4,
    textAlign: 'center', color: C.title,
  },
  titleRule: { width: 56, height: 2.5, backgroundColor: C.accent, alignSelf: 'center', marginTop: 14 },

  ident: { marginTop: 26 },
  identRow: { flexDirection: 'row', marginBottom: 9 },
  identGap: { width: 9 },
  card: { backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder, borderRadius: 5, paddingVertical: 11, paddingHorizontal: 14, flex: 1 },
  label: { fontFamily: 'Inter', fontWeight: 600, fontSize: 8, letterSpacing: 1.1, textTransform: 'uppercase', color: C.accent, marginBottom: 3 },
  value: { fontFamily: 'Inter', fontWeight: 500, fontSize: 11, color: C.ink, lineHeight: 1.4 },
  valueStrong: { fontFamily: 'Inter', fontWeight: 600, fontSize: 11, color: C.title, lineHeight: 1.4, marginTop: 2 },
  sub: { fontSize: 9, color: C.muted, lineHeight: 1.4, marginTop: 1.5 },

  // techniques (carte pleine largeur, 2 colonnes)
  techCols: { flexDirection: 'row', width: '100%', marginTop: 1 },
  techCol: { width: '50%' },
  checkRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 2 },
  checkOn: { width: 11, height: 11, borderRadius: 3, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center', marginRight: 6 },
  checkOnMark: { fontSize: 7, color: '#FFFFFF', fontFamily: 'Inter', fontWeight: 'bold' },
  checkOff: { width: 9, height: 9, borderWidth: 0.8, borderColor: C.muted, borderRadius: 2, marginRight: 7, marginLeft: 1 },
  checkLabel: { fontSize: 9, color: C.muted },
  checkLabelOn: { fontFamily: 'Inter', fontWeight: 600, color: C.title },

  // L'essentiel — encadré « takeaway » (filet accent à gauche)
  essentiel: { backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder, borderLeftWidth: 4, borderLeftColor: C.accent, borderRadius: 5, paddingVertical: 11, paddingHorizontal: 14 },
  essTitle: { fontFamily: 'Syne', fontWeight: 700, fontSize: 10.5, letterSpacing: 2, textTransform: 'uppercase', color: C.title, marginBottom: 8 },
  essPair: { flexDirection: 'row' },
  essCol: { flex: 1 },
  essGap: { width: 16 },

  footer: { marginTop: 'auto', paddingTop: 24, textAlign: 'center', fontSize: 7.5, lineHeight: 1.6, color: C.muted },
});

const styles = StyleSheet.create({
  page: {
    paddingTop: 96,     // réserve le header fixed
    paddingBottom: 64,  // réserve le footer fixed
    paddingHorizontal: 36,
    fontFamily: 'Inter',
    fontSize: 10,
    color: C.ink,
    backgroundColor: '#FFFFFF',
  },
  // ── Header (fixed) : logo couleur à gauche, coordonnées à droite, filet
  // accent en assise. ──
  header: { position: 'absolute', top: 26, left: 36, right: 36 },
  headerLogoRow: { flexDirection: 'row', justifyContent: 'center', marginBottom: 8 },
  headerFallback: { fontFamily: 'Syne', fontWeight: 'bold', fontSize: 20, color: C.title },
  headerCoords: { textAlign: 'right' },
  headerSociete: { fontFamily: 'Inter', fontWeight: 600, fontSize: 8, color: C.title, marginBottom: 1.5 },
  headerContact: { fontSize: 7, color: C.muted, lineHeight: 1.4 },
  headerRule: { height: 1, backgroundColor: C.accent },

  // ── Sections ── filet accent court AU-DESSUS du titre Syne. ──
  sectionRule: { width: 24, height: 2, backgroundColor: C.accent, marginTop: 18, marginBottom: 6 },
  sectionTitle: { fontFamily: 'Syne', fontWeight: 600, fontSize: 13, color: C.title, letterSpacing: 1, marginBottom: 8 },
  paragraph: { fontSize: 10, lineHeight: 1.5, color: C.ink, marginBottom: 6 },
  empty: { fontSize: 9.5, color: C.muted },

  // ── Photos (grille 2 colonnes, max 2 par ligne — règle métier) ──
  photosGrid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 6, marginBottom: 2 },
  photoCell: { width: '50%', paddingHorizontal: 4, marginBottom: 8, alignItems: 'center' },
  photoFrame: { borderWidth: 1, borderColor: C.cardBorder, borderRadius: 4, backgroundColor: C.paper, padding: 4 },
  photoCaption: { fontFamily: 'Inter', fontStyle: 'italic', fontSize: 8, color: C.muted, textAlign: 'center', marginTop: 4 },
  photoCaptionNum: { fontFamily: 'Inter', fontWeight: 600, fontStyle: 'normal', fontSize: 7.5, color: C.accent },

  // ── Clôture ──
  closing: { marginTop: 28, alignItems: 'flex-end' },
  faitA: { fontSize: 10.5, color: C.muted },
  faitADate: { fontFamily: 'Inter', fontWeight: 600, color: C.title },
  closingSociete: { fontFamily: 'Syne', fontWeight: 600, fontSize: 10, color: C.title, marginTop: 4 },
  closingTech: { fontSize: 9, color: C.muted, marginTop: 3 },

  // ── Footer (fixed) : 3 lignes + numéro de page ──
  footer: {
    position: 'absolute', left: 36, right: 36, bottom: 22,
    textAlign: 'center', fontSize: 6.5, color: C.muted, lineHeight: 1.5,
    borderTopWidth: 0.75, borderTopColor: C.cardBorder, paddingTop: 6,
  },
  footerDot: { color: C.accent },
  pageNumber: { position: 'absolute', right: 36, bottom: 22, fontSize: 7, color: C.muted },
});

// Découpe une section sur le séparateur '||PARA||' (cf. textToParas docx).
function paragraphs(text: string): string[] {
  return (text ?? '')
    .split('||PARA||')
    .map((s) => s.trim())
    .filter(Boolean);
}

// Résumé court pour le bloc « L'essentiel » de la couverture : coupe au mot
// près sous une longueur max et ajoute une ellipse. Le détail complet figure
// dans les sections CONCLUSION / RECOMMANDATION (dernière page).
function summarize(text: string, maxLen = 200): string {
  const s = (text ?? '').replace(/\s+/g, ' ').trim();
  if (s.length <= maxLen) return s;
  const cut = s.slice(0, maxLen);
  const i = cut.lastIndexOf(' ');
  return (i > 40 ? cut.slice(0, i) : cut).trimEnd() + '…';
}

function CheckItem({ label, checked }: { label: string; checked: boolean }) {
  return (
    <View style={cover.checkRow} wrap={false}>
      {checked
        ? <View style={cover.checkOn}><Text style={cover.checkOnMark}>✓</Text></View>
        : <View style={cover.checkOff} />}
      <Text style={[cover.checkLabel, checked ? cover.checkLabelOn : {}]}>{label}</Text>
    </View>
  );
}

function Section({ title, text }: { title: string; text: string }) {
  const paras = paragraphs(text);
  return (
    <View>
      {/* Filet + titre insécables avec la 1re ligne du corps : jamais de titre
          orphelin en bas de page. */}
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

// Ligne de footer : les « · » de séparation passent en accent (micro-signature
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

// Largeur utile A4 (595.28pt) − paddingHorizontal (2×36) = 523.28pt ; chaque
// cellule occupe 50% (− padding 8 − cadre 10). Hauteur dérivée du ratio
// intrinsèque (préservé) ; plafonnée pour qu'un cliché portrait ne dévore pas
// la page.
const PHOTO_COL_W = 243; // pt
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

// Grille 2 colonnes rendue en fin de section. Chaque paire cadre+légende est
// insécable (wrap={false}). `startNumber` : numérotation continue (DÉGÂTS puis
// INSPECTION), affichée « Photo N » en tête de légende.
function PhotosGrid({ photos, startNumber }: {
  photos: RapportPhotoData[] | undefined;
  startNumber: number;
}) {
  if (!photos || photos.length === 0) return null;
  return (
    <View style={styles.photosGrid}>
      {photos.map((p, i) => {
        const { width, height } = photoDisplaySize(p);
        const num = startNumber + i;
        return (
          <View key={i} style={styles.photoCell} wrap={false}>
            <View style={styles.photoFrame}>
              <Image src={{ data: p.bytes, format: 'jpg' }} style={{ width, height }} />
            </View>
            <Text style={styles.photoCaption}>
              <Text style={styles.photoCaptionNum}>Photo {num}{p.label ? ' — ' : ''}</Text>
              {p.label ?? ''}
            </Text>
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

  // Adresse d'intervention : rue « nette » (on retire le suffixe « – ACP nom »
  // que buildAdresseInterventionLine1 ajoute, car la ligne ACP + BCE ci-dessous
  // reprend déjà le nom de l'ACP). Repli sur la chaîne complète sans séparateur.
  const itvStreet = (data.adresse_ligne1 ?? '').split(/\s[–—-]\s/)[0].trim() || (data.adresse_ligne1 ?? '');
  const acpBce = facturationLines[0] ?? ''; // « ACP nom – BCE xxx »

  // Mandataire (donneur d'ordre) = le syndic : lignes facturation 2→4, le
  // « c/o » de tête retiré (redondant sous le libellé « Mandataire »).
  const mandataire = facturationLines.slice(1)
    .map((l, i) => (i === 0 ? l.replace(/^c\/o\s+/i, '') : l));

  // L'essentiel : 1er paragraphe de la conclusion (cause) et de la
  // recommandation (action) — purement dérivé, aucune donnée inventée.
  const essCause = summarize(paragraphs(data.conclusion)[0] ?? '');
  const essAction = summarize(paragraphs(data.recommandation)[0] ?? '');
  const showEssentiel = Boolean(essCause || essAction);

  // « Fait à » : ville d'intervention si renseignée, sinon repli sur le siège.
  const faitAVille = (data.fait_a_ville && data.fait_a_ville.trim()) || SOCIETE.ville;

  const techLeft = RAPPORT_TECHNIQUES.slice(0, 4);
  const techRight = RAPPORT_TECHNIQUES.slice(4, 8);

  return (
    <Document
      title={`Rapport ${data.numero}`}
      author="Fox Group srl"
      subject="Rapport d'intervention — détection de fuites"
    >
      {/* ── Couverture (claire) = fiche d'identification ── */}
      <Page size="A4" style={cover.page}>
        <View style={cover.logoZone}>
          {COLOR_LOGO
            ? <Image src={{ data: COLOR_LOGO, format: 'png' }} style={cover.logo} />
            : logo
              ? <Image src={{ data: logo, format: 'jpg' }} style={{ width: COVER_LOGO, height: Math.round(COVER_LOGO / 1.9) }} />
              : <Text style={cover.logoFallback}>FoxO</Text>}
          <Text style={cover.tagline}>Détection de fuites · Lekdetectie</Text>
        </View>

        <Text style={cover.title}>RAPPORT</Text>
        <Text style={cover.title}>D{'’'}INTERVENTION</Text>
        <View style={cover.titleRule} />

        <View style={cover.ident}>
          {/* N° intervention / Réf. dossier */}
          <View style={cover.identRow}>
            <View style={cover.card}>
              <Text style={cover.label}>N° intervention</Text>
              <Text style={cover.valueStrong}>{data.numero || '—'}</Text>
            </View>
            <View style={cover.identGap} />
            <View style={cover.card}>
              <Text style={cover.label}>{data.ref_label.replace(/\s*:\s*$/, '')}</Text>
              <Text style={cover.valueStrong}>{data.ref_value || '—'}</Text>
            </View>
          </View>

          {/* Objet */}
          <View style={cover.identRow}>
            <View style={cover.card}>
              <Text style={cover.label}>Objet de l{'’'}intervention</Text>
              <Text style={cover.value}>{data.objet || '—'}</Text>
            </View>
          </View>

          {/* Adresse d'intervention / Mandataire */}
          <View style={cover.identRow}>
            <View style={cover.card}>
              <Text style={cover.label}>Adresse d{'’'}intervention</Text>
              <Text style={cover.value}>{itvStreet || '—'}</Text>
              {acpBce ? <Text style={cover.valueStrong}>{acpBce}</Text> : null}
              {occupantLines.map((l, i) => <Text key={i} style={cover.sub}>{l}</Text>)}
            </View>
            <View style={cover.identGap} />
            <View style={cover.card}>
              <Text style={cover.label}>Mandataire (donneur d{'’'}ordre)</Text>
              {mandataire.length > 0
                ? mandataire.map((l, i) => (
                    <Text key={i} style={i === 0 ? cover.valueStrong : cover.value}>{l}</Text>
                  ))
                : <Text style={cover.value}>—</Text>}
            </View>
          </View>

          {/* Techniques d'inspection */}
          <View style={cover.identRow}>
            <View style={cover.card}>
              <Text style={[cover.label, { marginBottom: 5 }]}>Techniques d{'’'}inspection</Text>
              <View style={cover.techCols}>
                <View style={cover.techCol}>
                  {techLeft.map((tk) => (
                    <CheckItem key={tk.key} label={tk.label} checked={Boolean(data.techniques[tk.key])} />
                  ))}
                </View>
                <View style={cover.techCol}>
                  {techRight.map((tk) => (
                    <CheckItem key={tk.key} label={tk.label} checked={Boolean(data.techniques[tk.key])} />
                  ))}
                </View>
              </View>
            </View>
          </View>

          {/* L'essentiel — cause + action en tête de dossier */}
          {showEssentiel ? (
            <View style={cover.essentiel}>
              <Text style={cover.essTitle}>L{'’'}essentiel</Text>
              <View style={cover.essPair}>
                <View style={cover.essCol}>
                  <Text style={cover.label}>Cause la plus probable</Text>
                  <Text style={cover.value}>{essCause || '—'}</Text>
                </View>
                <View style={cover.essGap} />
                <View style={cover.essCol}>
                  <Text style={cover.label}>Action recommandée</Text>
                  <Text style={cover.value}>{essAction || '—'}</Text>
                </View>
              </View>
            </View>
          ) : null}
        </View>

        <View style={cover.footer}>
          <Text>{SOCIETE.ligne1}</Text>
          <Text>{SOCIETE.ligne2}</Text>
        </View>
      </Page>

      {/* ── Pages de contenu : démarrent directement sur les sections ── */}
      <Page size="A4" style={styles.page}>
        {/* Header (répété chaque page) */}
        <View style={styles.header} fixed>
          <View style={styles.headerLogoRow}>
            {COLOR_LOGO
              ? <Image src={{ data: COLOR_LOGO, format: 'png' }} style={{ width: 40, height: 48 }} />
              : logo
                ? <Image src={{ data: logo, format: 'jpg' }} style={{ width: HEADER_LOGO_W, height: Math.round(HEADER_LOGO_W / 1.9) }} />
                : <Text style={styles.headerFallback}>FoxO</Text>}
          </View>
          <View style={styles.headerRule} />
        </View>

        {/* 4 sections — photos en fin de DÉGÂTS et d'INSPECTION uniquement,
            numérotées en continu sur l'ensemble du document. */}
        <Section title="DÉGÂTS" text={data.degats} />
        <PhotosGrid photos={photos.degats} startNumber={1} />
        <Section title="INSPECTION" text={data.inspection} />
        <PhotosGrid photos={photos.inspection} startNumber={(photos.degats?.length ?? 0) + 1} />
        {/* CONCLUSION + RECOMMANDATION + clôture : page dédiée (dernière),
            détachée des constats DÉGÂTS/INSPECTION et des photos. */}
        <View break>
          <Section title="CONCLUSION" text={data.conclusion} />
          <Section title="RECOMMANDATION" text={data.recommandation} />

          {/* Clôture : uniquement « Fait à … » */}
          <View style={styles.closing} wrap={false}>
            <Text style={styles.faitA}>
              Fait à {faitAVille}, le <Text style={styles.faitADate}>{data.fait_a_date}</Text>
            </Text>
          </View>
        </View>

        {/* Footer 3 lignes + numéro de page (répétés chaque page) */}
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
