'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { LucideIcon } from 'lucide-react';
import {
  FileText,
  ClipboardList,
  FileEdit,
  Receipt,
  CreditCard,
  Bell,
  Package,
  BarChart3,
} from 'lucide-react';

interface Tab {
  href: string;
  icon: LucideIcon;
  label: string;
  exact?: boolean;     // si true, n'active que sur match exact (sinon prefix)
}
const TABS: readonly Tab[] = [
  { href: '/admin/facturation',              icon: FileText,        label: 'Factures',         exact: true },
  { href: '/admin/facturation/devis',        icon: ClipboardList,   label: 'Devis'            },
  { href: '/admin/facturation/notes-credit', icon: FileEdit,        label: 'Notes de crédit'  },
  { href: '/admin/notes-frais',              icon: Receipt,         label: 'Notes de frais'   },
  { href: '/admin/facturation/paiements',    icon: CreditCard,      label: 'Paiements'        },
  { href: '/admin/facturation/rappels',      icon: Bell,            label: 'Rappels'          },
  { href: '/admin/articles',                 icon: Package,         label: 'Catalogue'        },
  { href: '/admin/facturation/export',       icon: BarChart3,       label: 'Export comptable' },
];

// Sous-navigation horizontale du module facturation. Affichée comme bandeau
// d'onglets sous le header dans le layout `/admin/facturation/layout.tsx`
// ET dans `/admin/articles/page.tsx` (le Catalogue est rattaché au module
// même s'il vit sous /admin/articles).
export function FacturationTabs() {
  const pathname = usePathname();

  return (
    <div className="px-6 pt-3 bg-sand border-b border-sand-border flex-shrink-0">
      <div className="flex flex-wrap gap-0.5 -mb-px">
        {TABS.map((t) => {
          const active = t.exact === true
            ? pathname === t.href
            : pathname === t.href || pathname.startsWith(t.href + '/');
          const Icon = t.icon;
          return (
            <Link
              key={t.href}
              href={t.href}
              className={
                'flex items-center gap-1.5 px-3.5 py-2 rounded-t-lg text-[12px] font-bold border-b-2 transition-colors ' +
                (active
                  ? 'bg-cream border-navy text-navy'
                  : 'border-transparent text-ink-muted hover:text-ink hover:border-[rgba(27,58,107,.2)] dark:hover:border-[rgba(255,255,255,.2)]')
              }
            >
              <Icon size={14} aria-hidden />
              {t.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
