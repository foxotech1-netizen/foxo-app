/**
 * QA jetable — génère un PDF de rapport d'exemple (fixtures complètes) pour
 * vérifier que le moteur RapportPdf (jumeau du template) ne crashe pas et
 * produit un PDF non vide.
 *
 * Exécution :  npx tsx scripts/dev/preview-rapport-pdf.ts
 * Sortie    :  /tmp/rapport-preview.pdf
 *
 * Fixtures : toutes les zones remplies, 3 techniques cochées, 2 occupants.
 */
import { writeFileSync } from 'node:fs';
import { generateRapportPdf } from '../../src/lib/pdf/generate';
import { techniquesFromKeys } from '../../src/lib/rapport/techniques';
import type { ReportData } from '../../src/lib/rapport/build-docx';

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

async function main() {
  const buf = await generateRapportPdf(data);
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
