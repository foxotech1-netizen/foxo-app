import fs from 'node:fs/promises';
import path from 'node:path';

// Logo FoxO extrait du template Word (header). Asset partagé par les DEUX
// moteurs de rapport (docx via ImageRun, PDF via @react-pdf Image) afin que
// le rendu soit strictement identique au template.
//
// Dimensions d'origine dans le template (header, aligné à gauche) :
//   wp:extent cx=1952625 cy=1028700 EMU
//   → 153,75 × 81 pt   (÷12700)   |   ≈ 205 × 108 px (÷9525)
// Image native : JPEG 532×280 (ratio 1,90).
export const RAPPORT_LOGO = {
  // Dimensions cibles, dérivées de l'extent EMU du template.
  widthPt: 153.75,
  heightPt: 81,
  widthPx: 205,
  heightPx: 108,
  format: 'jpg' as const,
};

const LOGO_PATH = path.join(process.cwd(), 'src', 'lib', 'rapport', 'assets', 'logo-foxo.jpg');

// Lit les octets du logo. Best-effort : renvoie null si introuvable (le caller
// affiche alors un fallback texte), sans jamais faire échouer la génération.
// Le fichier est inclus dans le bundle serveur via next.config
// (outputFileTracingIncludes).
export async function getRapportLogoBytes(): Promise<Buffer | null> {
  try {
    return await fs.readFile(LOGO_PATH);
  } catch (e) {
    console.warn('[rapport/logo] logo introuvable:', e);
    return null;
  }
}
