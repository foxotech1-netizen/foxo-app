'use client';

import { useEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';

export interface RowMenuItem {
  label: string;
  icon?: LucideIcon | string;
  onClick?: () => void;
  href?: string;
  destructive?: boolean;
  disabled?: boolean;
  hidden?: boolean;
}

// Menu kebab "⋯" — popover ancré sur le bouton, fermé sur clic extérieur
// ou Escape. Utilisable dans des tables ou cartes pour exposer des actions
// secondaires sans encombrer la ligne. Touch-friendly (44×44 minimum sur
// le bouton et chaque item de menu).
//
// `direction` contrôle l'ouverture verticale : 'down' (défaut) place le
// popover sous le bouton, 'up' le place au-dessus — à utiliser dans les
// tables longues où la dernière ligne ouvrirait un menu coupé en bas de
// viewport.
export function RowMenu({
  items,
  align = 'right',
  direction = 'down',
  ariaLabel = 'Actions',
}: {
  items: RowMenuItem[];
  align?: 'left' | 'right';
  direction?: 'up' | 'down';
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const visible = items.filter((i) => !i.hidden);
  if (visible.length === 0) return null;

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setOpen((v) => !v);
        }}
        className="w-11 h-11 inline-flex items-center justify-center rounded-md text-ink-mid hover:bg-sand-mid dark:text-[#C8C2B8] dark:hover:bg-[rgba(255,255,255,.08)] transition-colors"
      >
        <span className="text-[18px] leading-none">⋯</span>
      </button>
      {open && (
        <div
          role="menu"
          className={
            'absolute z-50 min-w-[200px] rounded-lg border border-sand-border bg-cream shadow-lg overflow-hidden ' +
            (direction === 'up' ? 'bottom-full mb-1 ' : 'top-full mt-1 ') +
            (align === 'right' ? 'right-0' : 'left-0') +
            ' dark:bg-[#221E1A] dark:border-[#3D3A32] dark:shadow-2xl'
          }
        >
          {visible.map((item, i) => {
            const className =
              'w-full text-left px-3 py-2.5 text-[13px] font-medium flex items-center gap-2 min-h-[44px] transition-colors ' +
              (item.disabled
                ? 'opacity-50 cursor-not-allowed'
                : item.destructive
                ? 'text-terra hover:bg-terra-light dark:hover:bg-[#5A2E18]'
                : 'text-ink hover:bg-sand-mid dark:text-[#F0ECE4] dark:hover:bg-[rgba(255,255,255,.06)]');
            const iconNode = (() => {
              if (!item.icon) return null;
              if (typeof item.icon === 'string') {
                return <span className="text-[15px] leading-none">{item.icon}</span>;
              }
              const Icon = item.icon;
              return <Icon size={14} aria-hidden />;
            })();
            const inner = (
              <>
                {iconNode}
                <span className="flex-1">{item.label}</span>
              </>
            );
            if (item.href && !item.disabled) {
              return (
                <a
                  key={i}
                  href={item.href}
                  className={className}
                  onClick={() => setOpen(false)}
                >
                  {inner}
                </a>
              );
            }
            return (
              <button
                key={i}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  if (item.disabled) return;
                  item.onClick?.();
                  setOpen(false);
                }}
                className={className}
              >
                {inner}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
