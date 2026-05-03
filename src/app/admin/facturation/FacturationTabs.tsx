'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface Tab {
  href: string;
  icon: string;
  label: string;
  exact?: boolean;     // si true, n'active que sur match exact (sinon prefix)
}
const TABS: readonly Tab[] = [
  { href: '/admin/facturation',              icon: '📄', label: 'Factures',         exact: true },
  { href: '/admin/facturation/devis',        icon: '📋', label: 'Devis'            },
  { href: '/admin/facturation/notes-credit', icon: '📝', label: 'Notes de crédit'  },
  { href: '/admin/facturation/paiements',    icon: '💳', label: 'Paiements'        },
  { href: '/admin/facturation/rappels',      icon: '🔔', label: 'Rappels'          },
  { href: '/admin/articles',                 icon: '📦', label: 'Catalogue'        },
  { href: '/admin/facturation/export',       icon: '📊', label: 'Export comptable' },
];

// Sous-navigation horizontale du module facturation. Affichée comme bandeau
// d'onglets sous le header dans le layout `/admin/facturation/layout.tsx`
// ET dans `/admin/articles/page.tsx` (le Catalogue est rattaché au module
// même s'il vit sous /admin/articles).
export function FacturationTabs() {
  const pathname = usePathname();

  return (
    <div className="px-6 pt-3 bg-sand border-b border-sand-border flex-shrink-0 dark:bg-[#141210] dark:border-[#2C2A24]">
      <div className="flex flex-wrap gap-0.5 -mb-px">
        {TABS.map((t) => {
          const active = t.exact === true
            ? pathname === t.href
            : pathname === t.href || pathname.startsWith(t.href + '/');
          return (
            <Link
              key={t.href}
              href={t.href}
              className={
                'flex items-center gap-1.5 px-3.5 py-2 rounded-t-lg text-[12px] font-bold border-b-2 transition-colors ' +
                (active
                  ? 'bg-cream border-navy text-navy dark:bg-[#1C1A16] dark:text-[#A8C4F2] dark:border-[#7AA8E8]'
                  : 'border-transparent text-ink-muted hover:text-ink hover:border-[rgba(27,58,107,.2)] dark:text-[#C8C2B8] dark:hover:text-[#F0ECE4] dark:hover:border-[rgba(255,255,255,.2)]')
              }
            >
              <span aria-hidden>{t.icon}</span>
              {t.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
