'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useVocab } from './PortalContext';

export function PortalNav() {
  const pathname = usePathname();
  const v = useVocab();

  const tabs = [
    { href: '/portal', label: 'Tableau de bord' },
    { href: '/portal/interventions', label: v.interventionsCap },
    { href: '/portal/calendar', label: 'Disponibilités' },
    { href: '/portal/nouveau', label: v.newRequestVerb.replace(/^\+\s*/, '') },
  ];

  return (
    <nav className="bg-cream border-b border-sand-border sticky top-0 z-40">
      <div className="max-w-[1100px] mx-auto px-3 sm:px-6 flex items-center gap-1 overflow-x-auto">
        {tabs.map((tab) => {
          const active =
            pathname === tab.href ||
            (tab.href !== '/portal' && pathname.startsWith(tab.href + '/')) ||
            (tab.href === '/portal/nouveau' && pathname.startsWith('/portal/nouveau'));
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={
                'whitespace-nowrap px-3.5 py-3 text-[13px] border-b-2 transition-colors ' +
                (active
                  ? 'text-navy border-navy font-bold'
                  : 'text-ink-muted border-transparent hover:text-ink-mid font-medium')
              }
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
