import { renderToBuffer } from '@react-pdf/renderer';
import type { ReportData } from '@/lib/rapport/build-docx';
import { RapportPdf } from './RapportPdf';

// Génère le PDF du rapport à partir du MÊME ReportData que le moteur docx
// (source unique de données — cf. dispatch.ts buildRapportPdf).
export async function generateRapportPdf(data: ReportData): Promise<Buffer> {
  // renderToBuffer marche en environnement Node (Server Action / Route Handler).
  return await renderToBuffer(<RapportPdf data={data} />);
}
