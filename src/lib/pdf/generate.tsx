import { renderToBuffer } from '@react-pdf/renderer';
import type { ReportData } from '@/lib/rapport/build-docx';
import { getRapportLogoBytes } from '@/lib/rapport/logo';
import { RapportPdf } from './RapportPdf';

// Génère le PDF du rapport à partir du MÊME ReportData que le moteur docx
// (source unique de données — cf. dispatch.ts buildRapportPdf). Le logo
// (asset partagé, extrait du template) est lu ici et passé au composant.
export async function generateRapportPdf(data: ReportData): Promise<Buffer> {
  const logo = await getRapportLogoBytes();
  // renderToBuffer marche en environnement Node (Server Action / Route Handler).
  return await renderToBuffer(<RapportPdf data={data} logo={logo} />);
}
