// Badge de type partenaire/demandeur — couleurs solides toujours visibles,
// indépendamment du thème (clair ou sombre). Pas de variante dark: car les
// fonds sont déjà à fort contraste vs texte blanc.

const STYLES: Record<string, { bg: string; label: string }> = {
  courtier:    { bg: '#A17244', label: 'Courtier' },
  syndic:      { bg: '#1B3A6B', label: 'Syndic' },
  particulier: { bg: '#1F6B45', label: 'Particulier' },
};

export function TypeBadge({
  type,
  className,
}: {
  type: string;
  className?: string;
}) {
  const key = (type ?? '').toLowerCase();
  const style = STYLES[key] ?? { bg: '#3D3A32', label: type || '—' };
  return (
    <span
      className={
        'inline-block text-[10px] uppercase tracking-wider px-2 py-0.5 rounded ' +
        (className ?? '')
      }
      style={{ background: style.bg, color: '#FFFFFF', fontWeight: 600 }}
    >
      {style.label}
    </span>
  );
}
