import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Le system prompt FoxO est stocké en .md brut (lisible/éditable côté
// repo) et chargé au runtime côté serveur. Cache en mémoire après la
// première lecture pour éviter les I/O répétés.
//
// Vercel : on déclare le .md dans next.config.ts → outputFileTracingIncludes
// pour s'assurer que le fichier est inclus dans le bundle de fonction.

let cached: string | null = null;

export function getFoxoSystemPrompt(): string {
  if (cached) return cached;
  const path = join(process.cwd(), 'src/lib/prompts/foxo-rapport.md');
  cached = readFileSync(path, 'utf-8');
  return cached;
}
