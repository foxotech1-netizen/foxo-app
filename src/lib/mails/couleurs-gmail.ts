// Palette des libellés Gmail (couleurs IMPOSÉES par l'API Gmail : seules ces
// valeurs sont acceptées à la création d'un libellé). Données, pas tokens.
export const GMAIL_LABEL_COLORS = [
  { name: 'Rouge',   text: '#ffffff', bg: '#fb4c2f' },
  { name: 'Orange',  text: '#ffffff', bg: '#ffad47' },
  { name: 'Jaune',   text: '#000000', bg: '#fad165' },
  { name: 'Vert',    text: '#ffffff', bg: '#16a766' },
  { name: 'Bleu',    text: '#ffffff', bg: '#4a86e8' },
  { name: 'Violet',  text: '#ffffff', bg: '#a479e2' },
  { name: 'Rose',    text: '#ffffff', bg: '#f691b3' },
] as const;
