// Réponse binaire « fichier » sûre — patterns extraits de la route PJ
// Gmail admin (PR #91) pour être partagés avec les routes documents Drive
// du portail tech (Mails V2 P2 U4). Comportement strictement identique :
// - nom de fichier sans chemins/caractères de contrôle/quotes, borné 150 c. ;
// - MIME validé par regex puis whitelist de préfixes, sinon octet-stream ;
// - inline uniquement image/* (JAMAIS le SVG — il peut embarquer du script
//   → XSS sur l'origine) et application/pdf ;
// - Content-Disposition avec filename* RFC 5987 (accents) + repli ASCII ;
// - X-Content-Type-Options: nosniff + Content-Security-Policy: sandbox
//   (défense en profondeur si un type inline était un jour mal classé) ;
// - Cache-Control: private, max-age=300.

const MIME_PREFIX_WHITELIST = [
  'image/',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'text/plain',
  'text/csv',
  'application/zip',
];

export function sanitizeFilename(raw: string): string {
  const cleaned = raw
    .replace(/[/\\]/g, '_')            // chemins
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1F\x7F]/g, '')   // caractères de contrôle
    .replace(/["';]/g, '')             // quoting des en-têtes
    .trim()
    .slice(0, 150);
  return cleaned || 'piece-jointe';
}

export function sanitizeMime(raw: string): string {
  const mime = raw.trim().toLowerCase();
  if (!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(mime)) return 'application/octet-stream';
  return MIME_PREFIX_WHITELIST.some((p) => mime.startsWith(p))
    ? mime
    : 'application/octet-stream';
}

/** En-têtes complets pour servir `byteLength` octets de type `mime`
    (déjà sanitisés par les fonctions ci-dessus). */
export function buildSafeFileHeaders(args: {
  filename: string;
  mime: string;
  byteLength: number;
}): Record<string, string> {
  const { filename, mime, byteLength } = args;
  const inline = (mime.startsWith('image/') && mime !== 'image/svg+xml') || mime === 'application/pdf';
  const asciiName = filename.replace(/[^\x20-\x7E]/g, '_');
  return {
    'Content-Type': mime,
    'Content-Disposition':
      `${inline ? 'inline' : 'attachment'}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    'Content-Length': String(byteLength),
    'Cache-Control': 'private, max-age=300',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': 'sandbox',
  };
}
