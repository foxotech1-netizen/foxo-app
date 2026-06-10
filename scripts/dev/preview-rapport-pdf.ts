/**
 * QA jetable — génère un PDF de rapport d'exemple (fixtures complètes) pour
 * vérifier que le moteur RapportPdf (jumeau du template) ne crashe pas et
 * produit un PDF non vide.
 *
 * Exécution :  npx tsx scripts/dev/preview-rapport-pdf.ts
 * Sortie    :  /tmp/rapport-preview.pdf
 *
 * Fixtures : toutes les zones remplies, 3 techniques cochées, 2 occupants,
 * et 3 photos de test générées localement par sharp (rectangles de couleur
 * unie) — un paysage standard + un très large (DÉGÂTS), un très haut
 * (INSPECTION) — pour vérifier la grille 2 colonnes, le ratio préservé et
 * l'absence de chevauchement avec le footer.
 */
import { writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { generateRapportPdf } from '../../src/lib/pdf/generate';
import { techniquesFromKeys } from '../../src/lib/rapport/techniques';
import type { ReportData } from '../../src/lib/rapport/build-docx';
import type { RapportPhotoData, RapportPhotosBySection } from '../../src/lib/rapport/photos';

const data: ReportData = {
  numero: '2026-000',
  ref_label: 'Réf. dossier :',
  ref_value: '2026-000',
  objet: 'Recherche d\'origine de fuite – Investigation appartements E44 et E54',
  facturation_ligne1: 'ACP MANNEKEN  –  BCE 0672.424.289',
  facturation_ligne2: 'c/o Immo Gestion Syndic  –  Mme Caroline Mignon',
  facturation_ligne3: 'Avenue de Fré 229',
  facturation_ligne4: '1180 Bruxelles',
  adresse_ligne1: 'Rue de l\'Étuve 50-52, 1000 Bruxelles  –  ACP MANNEKEN',
  adresse_ligne2:
    'Appartement E44 : Sarah Barbieux (locataire)\nAppartement E54 : M. Tuna (propriétaire)',
  adresse_ligne3: '',
  techniques: techniquesFromKeys(['capteur', 'camera', 'visuelle']),
  degats:
    'Traces d\'humidité visibles au plafond de la salle de bain de l\'appartement E44.||PARA||Boursouflures de peinture et auréoles brunâtres signalées par l\'occupante.',
  inspection:
    'Mesures au capteur d\'humidité réalisées dans l\'appartement E44 : valeurs élevées au droit du mur mitoyen.||PARA||Inspection à la caméra endoscopique de la gaine technique : présence d\'eau stagnante.',
  conclusion:
    'La cause la plus vraisemblable est une fuite sur la colonne d\'évacuation desservant l\'appartement E54. La présence d\'eau ne peut être totalement exclue ailleurs.',
  recommandation:
    'Faire intervenir un plombier sur la colonne d\'évacuation de l\'E54.||PARA||Prévoir un nouveau relevé au capteur d\'humidité après réparation et séchage.',
  fait_a_date: '10/06/2026',
};

// Rectangle de couleur unie → RapportPhotoData (octets JPEG + dims intrinsèques).
async function solidPhoto(
  width: number,
  height: number,
  rgb: { r: number; g: number; b: number },
  label: string | null,
): Promise<RapportPhotoData> {
  const bytes = await sharp({ create: { width, height, channels: 3, background: rgb } })
    .jpeg({ quality: 80 })
    .toBuffer();
  return { bytes, width, height, label };
}

async function buildTestPhotos(): Promise<RapportPhotosBySection> {
  return {
    // DÉGÂTS : un paysage standard (4:3) + un cliché TRÈS LARGE (panorama).
    degats: [
      await solidPhoto(1600, 1200, { r: 70, g: 110, b: 160 }, 'Plafond salle de bain E44 — auréoles'),
      await solidPhoto(2600, 650, { r: 150, g: 90, b: 80 }, 'Vue panoramique du mur mitoyen (très large)'),
    ],
    // INSPECTION : un cliché TRÈS HAUT (portrait étroit).
    inspection: [
      await solidPhoto(650, 2000, { r: 90, g: 150, b: 110 }, 'Gaine technique sur toute la hauteur (très haut)'),
    ],
  };
}

async function main() {
  const photos = await buildTestPhotos();
  const buf = await generateRapportPdf(data, photos);
  const out = '/tmp/rapport-preview.pdf';
  writeFileSync(out, buf);
  // eslint-disable-next-line no-console
  console.log(`OK — PDF généré (${buf.byteLength} octets) → ${out}`);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('ÉCHEC génération PDF :', e);
  process.exit(1);
});
