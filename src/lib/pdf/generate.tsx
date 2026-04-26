import { renderToBuffer } from '@react-pdf/renderer';
import { RapportPdf, type RapportPdfData } from './RapportPdf';

export async function generateRapportPdf(data: RapportPdfData): Promise<Buffer> {
  // renderToBuffer marche en environnement Node (Server Action / Route Handler).
  return await renderToBuffer(<RapportPdf data={data} />);
}
