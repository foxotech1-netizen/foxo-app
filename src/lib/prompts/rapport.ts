import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Le system prompt FoxO est stocké en .md brut (lisible/éditable côté
// repo) et chargé au runtime côté serveur. Cache en mémoire après la
// première lecture pour éviter les I/O répétés.
//
// Vercel : on déclare le .md dans next.config.ts → outputFileTracingIncludes
// pour s'assurer que le fichier est inclus dans le bundle de fonction.

let cached: string | null = null;

// Prompt historique (foxo-rapport.md) — conservé mais plus référencé par la
// génération (c'était une spec docx hors-sujet). Laissé pour archive.
export function getFoxoSystemPrompt(): string {
  if (cached) return cached;
  const path = join(process.cwd(), 'src/lib/prompts/foxo-rapport.md');
  cached = readFileSync(path, 'utf-8');
  return cached;
}

// Prompt v2 — rédacteur de rapport (4 sections + techniques + photos), aligné
// mot pour mot sur les consignes du template. Source de vérité de la PASSE 2.
let cachedV2: string | null = null;
export function getFoxoRapportV2Prompt(): string {
  if (cachedV2) return cachedV2;
  const path = join(process.cwd(), 'src/lib/prompts/foxo-rapport-v2.md');
  cachedV2 = readFileSync(path, 'utf-8');
  return cachedV2;
}
