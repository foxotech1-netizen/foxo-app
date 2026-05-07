import {
  Building2,
  CalendarDays,
  Landmark,
  Search,
  type LucideIcon,
} from 'lucide-react';
import { Logo } from '@/components/Logo';
import { EspaceClientTile } from './EspaceClientTile';

// Page publique sans donnée serveur. force-static permet la mise en
// cache CDN (le contenu et les liens sont constants).
export const dynamic = 'force-static';

type Tile = {
  href: string;
  icon: LucideIcon;
  label: string;
  subtitle: string;
  iconColor: string;
};

const TILES_BEFORE_CLIENT: Tile[] = [
  {
    href: 'https://portal.foxo.be/syndic',
    icon: Building2,
    label: 'Syndic',
    subtitle: 'Accédez à vos dossiers',
    iconColor: '#60A5FA',
  },
  {
    href: 'https://portal.foxo.be/expert',
    icon: Search,
    label: 'Expert',
    subtitle: 'Espace experts sinistres',
    iconColor: '#34D399',
  },
  {
    href: 'https://portal.foxo.be/courtier',
    icon: Landmark,
    label: 'Courtier',
    subtitle: 'Suivi dossiers clients',
    iconColor: '#A78BFA',
  },
];

const TILE_RDV: Tile = {
  href: 'https://portal.foxo.be/rdv',
  icon: CalendarDays,
  label: 'Prise de RDV',
  subtitle: 'Demandez une intervention',
  iconColor: '#FB923C',
};

export default function AppHubPage() {
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
          Espace Partenaires &amp; Clients
        </div>
      </header>

      <main className="flex-1 w-full px-4 py-4 flex items-start justify-center">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-[680px]">
          {TILES_BEFORE_CLIENT.map((t, i) => (
            <CompactTile key={t.href} tile={t} delayMs={i * 50} />
          ))}
          <EspaceClientTile delayMs={3 * 50} />
          <CompactTile tile={TILE_RDV} delayMs={4 * 50} />
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

function CompactTile({ tile, delayMs }: { tile: Tile; delayMs: number }) {
  const Icon = tile.icon;
  return (
    <a
      href={tile.href}
      target="_blank"
      rel="noopener noreferrer"
      className="hub-tile"
      style={{ animation: `hubFadeInUp 0.4s ease-out ${delayMs}ms both` }}
    >
      <div className="flex items-start gap-3 p-4 sm:p-5">
        <div
          className="w-11 h-11 rounded-[10px] flex items-center justify-center flex-shrink-0"
          style={{ background: `${tile.iconColor}26` }}
        >
          <Icon size={22} style={{ color: tile.iconColor }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-bold font-display text-white">
            {tile.label}
          </div>
          <div
            className="text-[13px] mt-0.5"
            style={{ color: 'rgba(255,255,255,0.6)' }}
          >
            {tile.subtitle}
          </div>
        </div>
      </div>
    </a>
  );
}
