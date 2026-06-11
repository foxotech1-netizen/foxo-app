import { renderToBuffer } from '@react-pdf/renderer';
import type { ReportData } from '@/lib/rapport/build-docx';
import type { RapportPhotosBySection } from '@/lib/rapport/photos';
import { getRapportLogoBytes } from '@/lib/rapport/logo';
import { RapportPdf } from './RapportPdf';

// Génère le PDF du rapport à partir du MÊME ReportData que le moteur docx
// (source unique de données — cf. dispatch.ts buildRapportPdf, le SEUL point
// de construction réutilisé par l'aperçu admin ET l'envoi syndic). Le logo
// (asset partagé, extrait du template) est lu ici et passé au composant.
//
// `photos` est OBLIGATOIRE (tableau vide explicite si aucune photo). C'est
// volontaire : un paramètre optionnel avait laissé passer une régression où un
// appelant oubliait les photos sans rien casser à la compilation. Désormais
// tout appelant DOIT fournir les photos (issues de fetchRapportPhotos), ce qui
// garantit que l'aperçu reste strictement identique au PDF réellement envoyé.
export async function generateRapportPdf(
  data: ReportData,
  photos: RapportPhotosBySection,
): Promise<Buffer> {
  const logo = await getRapportLogoBytes();
  // renderToBuffer marche en environnement Node (Server Action / Route Handler).
  return await renderToBuffer(<RapportPdf data={data} logo={logo} photos={photos} />);
}
