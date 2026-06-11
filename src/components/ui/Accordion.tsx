'use client';

// Accordion — bloc dépliable simple, utilisé sur mobile pour cacher
// le détail du Tableau de bord derrière un en-tête cliquable.
// Repose sur les tokens FoxO (cream / sand-mid / navy-pale / ink) et
// la card signature (triple shadow stack).

import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

interface AccordionProps {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
  badge?: string | number;
}

export function Accordion({ title, defaultOpen = false, children, badge }: AccordionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div
      className="rounded-card"
      style={{
        background: 'var(--color-cream)',
        boxShadow:
          '0 1px 2px rgba(15,32,64,0.04), 0 4px 12px rgba(15,32,64,0.05), 0 0 0 1px rgba(15,32,64,0.04)',
      }}
    >
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        className="w-full flex items-center justify-between px-4 py-3 min-h-[48px] cursor-pointer text-left"
        style={{ color: 'var(--color-ink)' }}
      >
        <span className="font-sora text-sm font-medium flex items-center gap-2">
          {title}
          {badge !== undefined && badge !== null && badge !== '' && badge !== 0 && (
            <span
              className="px-2 py-0.5 rounded-full text-xs font-semibold"
              style={{
                background: 'var(--color-navy-pale)',
                color: 'var(--color-navy)',
              }}
            >
              {badge}
            </span>
          )}
        </span>
        <ChevronDown
          size={18}
          style={{
            transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s',
            color: 'var(--color-ink-mid)',
          }}
          aria-hidden
        />
      </button>
      {isOpen && (
        <div className="px-4 pb-4 pt-1">
          {children}
        </div>
      )}
    </div>
  );
}
