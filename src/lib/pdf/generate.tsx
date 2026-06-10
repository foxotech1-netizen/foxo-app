import { renderToBuffer } from '@react-pdf/renderer';
import type { ReportData } from '@/lib/rapport/build-docx';
import type { RapportPhotosBySection } from '@/lib/rapport/photos';
import { getRapportLogoBytes } from '@/lib/rapport/logo';
import { RapportPdf } from './RapportPdf';

// Génère le PDF du rapport à partir du MÊME ReportData que le moteur docx
// (source unique de données — cf. dispatch.ts buildRapportPdf). Le logo
// (asset partagé, extrait du template) est lu ici et passé au composant.
// Les photos (octets normalisés JPEG + dimensions) sont téléchargées en amont
// (dispatch.ts) et passées en props — RapportPdf reste un composant pur (aucun
// I/O réseau dans le rendu).
export async function generateRapportPdf(
  data: ReportData,
  photos?: RapportPhotosBySection | null,
): Promise<Buffer> {
  const logo = await getRapportLogoBytes();
  // renderToBuffer marche en environnement Node (Server Action / Route Handler).
  return await renderToBuffer(<RapportPdf data={data} logo={logo} photos={photos} />);
}
