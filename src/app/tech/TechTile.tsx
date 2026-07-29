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

// Carte de navigation de l'accueil technicien (thème sombre) : carte verre
// horizontale pleine largeur [carré d'icône coloré 46px] + [titre +
// sous-titre] + [pastille compteur]. Tout l'habillage (verre, relief du
// carré, enfoncement au tap) vit dans globals.css sous .tech-tile /
// .tech-chip / .tech-badge — le :active n'est pas exprimable en style
// inline, et le design system FoxO interdit les hex en dur ici.

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
export type TechTileVariant = 'violet' | 'green' | 'amber' | 'orange' | 'sky';

interface TechTileProps {
  href: string;
  label: string;
  /** Sous-titre descriptif court sous le titre (ex. "Missions du jour"). */
  subtitle: string;
  icon: TechTileIcon;
  /** Couleur du carré d'icône. */
  variant: TechTileVariant;
  /** Compteur affiché en pastille à droite. Masquée si absent ou ≤ 0. */
  badge?: number;
  badgeVariant?: 'red' | 'amber';
}

export function TechTile({
  href,
  label,
  subtitle,
  icon,
  variant,
  badge,
  badgeVariant = 'red',
}: TechTileProps) {
  const Icon = ICONS[icon];
  const showBadge = typeof badge === 'number' && badge > 0;

  return (
    <Link
      href={href}
      className="tech-tile"
      // La pastille est aria-hidden (un nombre nu n'a pas de sens à l'oral) :
      // son information est reportée dans le libellé accessible du lien.
      aria-label={
        showBadge
          ? `${label} — ${badge} mission${badge > 1 ? 's' : ''}`
          : undefined
      }
    >
      <span className={`tech-chip tech-chip-${variant}`}>
        <Icon size={23} strokeWidth={2.2} aria-hidden />
      </span>
      <span className="flex-1 min-w-0">
        <span
          className="block font-sora font-bold text-[15.5px] leading-tight tracking-[-0.01em]"
          style={{ color: 'var(--tech-text-1)' }}
        >
          {label}
        </span>
        <span
          className="block text-[12px] mt-0.5 truncate"
          style={{ color: 'var(--tech-text-2)' }}
        >
          {subtitle}
        </span>
      </span>
      {showBadge && (
        <span
          className={
            badgeVariant === 'amber'
              ? 'tech-badge tech-badge-amber'
              : 'tech-badge'
          }
          aria-hidden
        >
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </Link>
  );
}
