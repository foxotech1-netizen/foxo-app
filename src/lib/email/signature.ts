// Signature société officielle des mails sortants — contenu EXACT fourni
// par Foxo (2026-07-02). Deux lignes, rien d'autre :
//   FoxO — Détection de fuites non intrusive
//   📞 0488/700.007 · ✉️ info@foxo.be
// PAS de nom de personne, PAS de logo image, PAS de « Fox Group SRL ».
// Icônes = caractères simples (pas d'images). En HTML, le mail est un
// lien mailto:. Séparateur fin au-dessus, petite taille, gris atténué.

export const SIGNATURE_TEXT =
  'FoxO — Détection de fuites non intrusive\n'
  + '📞 0488/700.007 · ✉️ info@foxo.be';

// Couleurs = tokens FoxO en littéral (les clients mail ne lisent pas les
// variables CSS) : ink-mid #6B6558, navy #1B3A6B, sand-border #DDD8CC.
export const SIGNATURE_HTML =
  '<div style="height:1px;background:#DDD8CC;margin:16px 0 12px"></div>'
  + '<p style="font-size:12px;color:#6B6558;line-height:1.7;margin:0">'
  + '<strong style="color:#1B3A6B">FoxO</strong> — Détection de fuites non intrusive<br>'
  + '📞&nbsp;0488/700.007 &nbsp;·&nbsp; ✉️&nbsp;'
  + '<a href="mailto:info@foxo.be" style="color:#1B3A6B;text-decoration:none">info@foxo.be</a>'
  + '</p>';

// Garde anti-doublon : détecte les coordonnées (email OU téléphone au
// format officiel), insensible à la casse et aux espaces — plus fiable
// qu'un nom. Couvre aussi les footers historiques (VENDOR.email) et les
// signatures déjà tapées par l'admin dans une réponse libre.
export function hasSignature(body: string): boolean {
  const norm = body.toLowerCase().replace(/\s+/g, '');
  return norm.includes('info@foxo.be') || norm.includes('0488/700.007');
}

// Corps texte brut (réponses Gmail) : appende la signature après une
// ligne vide + le délimiteur standard « -- ». No-op si déjà signée.
export function appendSignatureToText(body: string): string {
  if (hasSignature(body)) return body;
  return `${body.replace(/\s+$/, '')}\n\n-- \n${SIGNATURE_TEXT}`;
}

// Corps HTML : insère le bloc avant </body> si présent, sinon à la fin.
// No-op si le corps contient déjà les coordonnées.
export function appendSignatureToHtml(html: string): string {
  if (hasSignature(html)) return html;
  const m = html.match(/<\/body\s*>/i);
  if (m && m.index !== undefined) {
    return html.slice(0, m.index) + SIGNATURE_HTML + html.slice(m.index);
  }
  return html + SIGNATURE_HTML;
}
