'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface NavItem { href: string; icon: string; label: string; exact?: boolean }
const ITEMS: readonly NavItem[] = [
  { href: '/tech',            icon: '🏠', label: 'Accueil',    exact: true },
  { href: '/tech/historique', icon: '📋', label: 'Historique' },
];

// Bottom nav PWA — fixe en bas, safe-area inset iOS, min-height 44px par
// item (touch target Apple HIG). Le layout réserve déjà 90px de padding
// bottom pour ne pas masquer le contenu.
export function TechBottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 bg-cream border-t border-sand-border z-40 dark:bg-[#1C1A16] dark:border-[#2C2A24]"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
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
              className={
                'flex-1 flex flex-col items-center justify-center py-2.5 min-h-[58px] gap-0.5 transition-colors ' +
                (active
                  ? 'text-navy dark:text-[#A8C4F2]'
                  : 'text-ink-muted hover:text-ink dark:text-[#C8C2B8] dark:hover:text-[#F0ECE4]')
              }
            >
              <span className="text-[20px] leading-none" aria-hidden>{item.icon}</span>
              <span className="text-[10px] font-bold uppercase tracking-wider">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
