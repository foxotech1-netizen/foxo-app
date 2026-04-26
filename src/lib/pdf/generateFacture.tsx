import { renderToBuffer } from '@react-pdf/renderer';
import { FacturePdf, type FacturePdfData } from './FacturePdf';

export async function generateFacturePdf(data: FacturePdfData): Promise<Buffer> {
  return await renderToBuffer(<FacturePdf data={data} />);
}
