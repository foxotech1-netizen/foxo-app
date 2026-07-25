'use client';

import Link from 'next/link';
import {
  CalendarCheck,
  CalendarClock,
  ClipboardList,
  Receipt,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';

// Tuile 3D « icône iOS » de l'accueil technicien. Tout l'habillage visuel
// (dégradés, reflet, relief, enfoncement au tap) vit dans globals.css sous
// les classes .fx-tile* : le :active n'est pas exprimable en style inline,
// et le design system FoxO interdit les hex en dur ici.

// Mapping interne nom → composant lucide.
//
// ⚠ Ne JAMAIS remplacer `icon` par une prop composant. /tech/page.tsx est un
// server component : lui faire passer un composant lucide (donc une fonction)
// à travers la frontière RSC casse la sérialisation et fait planter le rendu
// — c'est exactement la régression de la PR #48. La page passe une CHAÎNE,
// la résolution en composant se fait ici, côté client.
const ICONS = {
  'calendar-check': CalendarCheck,
  'calendar-clock': CalendarClock,
  'clipboard-list': ClipboardList,
  receipt: Receipt,
  sparkles: Sparkles,
} satisfies Record<string, LucideIcon>;

export type TechTileIcon = keyof typeof ICONS;
export type TechTileVariant = 'navy' | 'amber' | 'tech' | 'slate' | 'light';

interface TechTileProps {
  /** Route interne (`/tech/...`) ou ancre de la page courante (`#...`). */
  href: string;
  label: string;
  icon: TechTileIcon;
  variant: TechTileVariant;
  /** Compteur affiché en pastille. Masquée si absent ou ≤ 0. */
  badge?: number;
  badgeVariant?: 'red' | 'amber';
}

export function TechTile({
  href,
  label,
  icon,
  variant,
  badge,
  badgeVariant = 'red',
}: TechTileProps) {
  const Icon = ICONS[icon];
  const showBadge = typeof badge === 'number' && badge > 0;

  const inner = (
    <>
      <span className={`fx-tile fx-tile-${variant}`}>
        <Icon size={32} strokeWidth={2} aria-hidden />
        {showBadge && (
          <span
            className={
              badgeVariant === 'amber'
                ? 'fx-tile-badge fx-tile-badge-amber'
                : 'fx-tile-badge'
            }
            aria-hidden
          >
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </span>
      <span className="fx-tile-label">{label}</span>
    </>
  );

  // La pastille est aria-hidden (un nombre nu n'a pas de sens à l'oral) :
  // son information est reportée dans le libellé accessible du lien.
  const ariaLabel = showBadge
    ? `${label} — ${badge} mission${badge > 1 ? 's' : ''}`
    : undefined;

  // Les ancres restent de simples <a> : la page est en `force-dynamic`, un
  // <Link href="/tech#…"> déclencherait un aller-retour serveur complet là
  // où l'on veut seulement défiler jusqu'à la section.
  if (href.startsWith('#')) {
    return (
      <a href={href} className="fx-tile-link" aria-label={ariaLabel}>
        {inner}
      </a>
    );
  }

  return (
    <Link href={href} className="fx-tile-link" aria-label={ariaLabel}>
      {inner}
    </Link>
  );
}
