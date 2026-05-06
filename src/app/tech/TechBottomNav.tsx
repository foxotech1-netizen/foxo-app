'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Clipboard, Receipt, type LucideIcon } from 'lucide-react';

interface NavItem { href: string; Icon: LucideIcon; label: string; exact?: boolean }
const ITEMS: readonly NavItem[] = [
  { href: '/tech',             Icon: Home,      label: 'Accueil',    exact: true },
  { href: '/tech/historique',  Icon: Clipboard, label: 'Historique' },
  { href: '/tech/notes-frais', Icon: Receipt,   label: 'Notes'      },
];

// Bottom nav PWA — fixe en bas, safe-area inset iOS, min-height 44px par
// item (touch target Apple HIG). Le layout réserve déjà 90px de padding
// bottom pour ne pas masquer le contenu.
export function TechBottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40"
      style={{
        background: '#FFFFFF',
        borderTop: '1px solid #E6E2DC',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
    >
      <div className="max-w-[640px] mx-auto flex">
        {ITEMS.map((item) => {
          const active = item.exact === true
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(item.href + '/');
          return (
            <Link
              key={item.href}
              href={item.href}
              className="relative flex-1 flex flex-col items-center justify-center py-2.5 min-h-[58px] gap-0.5"
              style={{
                color: active ? '#34D399' : '#9A9690',
                transition: 'color 0.15s ease',
              }}
            >
              {active && (
                <span
                  aria-hidden
                  className="absolute top-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full"
                  style={{ background: '#34D399' }}
                />
              )}
              <item.Icon size={22} aria-hidden />
              <span className="text-[10px] font-bold uppercase tracking-wider">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
