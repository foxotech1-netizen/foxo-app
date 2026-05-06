import {
  LayoutDashboard,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { Logo } from '@/components/Logo';

// Page publique — pas de check auth (volontaire, cf. spec). Sert de
// pivot visuel entre admin.foxo.be et tech.foxo.be ; le contrôle
// d'accès est géré côté chaque sous-domaine cible (proxy.ts +
// admin/layout.tsx, tech/layout.tsx).
export const dynamic = 'force-static';

type Tile = {
  href: string;
  icon: LucideIcon;
  label: string;
  subtitle: string;
  iconColor: string;
};

const TILES: Tile[] = [
  {
    href: 'https://admin.foxo.be',
    icon: LayoutDashboard,
    label: 'Administration',
    subtitle: 'Interventions · Facturation · Clients',
    iconColor: '#FBBF24',
  },
  {
    href: 'https://tech.foxo.be',
    icon: Wrench,
    label: 'App Terrain',
    subtitle: 'Rapports · Photos · Paiements',
    iconColor: '#34D399',
  },
];

export default function GoHubPage() {
  return (
    <div
      className="min-h-screen flex flex-col items-center"
      style={{
        background: 'linear-gradient(180deg, #0F1E35 0%, #1A3A5C 100%)',
      }}
    >
      <header className="w-full pt-16 pb-8 flex flex-col items-center px-4">
        <Logo
          size={56}
          variant="black"
          priority
          className="brightness-0 invert"
        />
        <div
          className="w-32 h-px mt-6 mb-4"
          style={{ background: 'rgba(255,255,255,0.15)' }}
        />
        <div
          className="text-[13px] font-display font-semibold uppercase text-center"
          style={{
            letterSpacing: '0.3em',
            color: 'rgba(255,255,255,0.5)',
          }}
        >
          Accès Interne FoxO
        </div>
      </header>

      <main className="flex-1 w-full px-4 py-4 flex items-start justify-center">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-[680px]">
          {TILES.map((t, i) => {
            const Icon = t.icon;
            return (
              <a
                key={t.href}
                href={t.href}
                target="_blank"
                rel="noopener noreferrer"
                className="hub-tile"
                style={{
                  minHeight: '200px',
                  animation: `hubFadeInUp 0.4s ease-out ${i * 50}ms both`,
                }}
              >
                <div className="flex items-start gap-4 p-7 h-full">
                  <div
                    className="w-11 h-11 rounded-[10px] flex items-center justify-center flex-shrink-0"
                    style={{ background: `${t.iconColor}26` }}
                  >
                    <Icon size={22} style={{ color: t.iconColor }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[17px] font-bold font-display text-white">
                      {t.label}
                    </div>
                    <div
                      className="text-[14px] mt-1"
                      style={{ color: 'rgba(255,255,255,0.6)' }}
                    >
                      {t.subtitle}
                    </div>
                  </div>
                </div>
              </a>
            );
          })}
        </div>
      </main>

      <footer
        className="w-full text-center pb-8 pt-12"
        style={{ color: 'rgba(255,255,255,0.3)', fontSize: '12px' }}
      >
        © Fox Group SRL · foxo.be
      </footer>
    </div>
  );
}
