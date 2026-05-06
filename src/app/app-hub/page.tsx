import {
  Building2,
  CalendarDays,
  Landmark,
  Search,
  type LucideIcon,
} from 'lucide-react';
import { Logo } from '@/components/Logo';
import { EspaceClientTile } from './EspaceClientTile';

// Page publique — pas d'auth, pas de SSR data. force-static pour
// permettre la mise en cache CDN (le contenu est constant, et les
// liens sont externes).
export const dynamic = 'force-static';

type Tile = {
  href: string;
  icon: LucideIcon;
  label: string;
  subtitle: string;
  accent: string;
};

const TILES_TOP: Tile[] = [
  {
    href: 'https://portal.foxo.be',
    icon: Building2,
    label: 'Syndic',
    subtitle: 'Accédez à vos dossiers et documents',
    accent: '#3B82C4',
  },
  {
    href: 'https://portal.foxo.be/expert',
    icon: Search,
    label: 'Expert',
    subtitle: 'Espace experts en sinistres',
    accent: '#2D9E6B',
  },
  {
    href: 'https://portal.foxo.be/courtier',
    icon: Landmark,
    label: 'Courtier',
    subtitle: 'Suivi de vos dossiers clients',
    accent: '#9B59B6',
  },
];

const TILE_RDV: Tile = {
  href: 'https://portal.foxo.be/rdv',
  icon: CalendarDays,
  label: 'Prise de RDV',
  subtitle: 'Demandez une intervention',
  accent: '#C8924A',
};

export default function AppHubPage() {
  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#F7F5F2' }}>
      <header
        className="px-6 py-10 text-center"
        style={{ background: 'linear-gradient(180deg, #1A1916 0%, #2C2A24 100%)' }}
      >
        <div className="flex justify-center mb-4">
          <Logo size={56} variant="black" priority className="brightness-0 invert" />
        </div>
        <h1 className="text-2xl font-extrabold text-white font-display">
          Bienvenue chez FoxO
        </h1>
      </header>

      <main className="flex-1 px-6 py-10 flex justify-center">
        <div className="grid grid-cols-2 gap-5 max-w-[600px]">
          {TILES_TOP.map((t) => (
            <ExternalTile key={t.href} tile={t} />
          ))}
          <EspaceClientTile />
          <ExternalTile tile={TILE_RDV} />
        </div>
      </main>

      <footer className="text-center py-6 text-[11px]" style={{ color: '#8A8278' }}>
        © Fox Group SRL — foxo.be
      </footer>
    </div>
  );
}

function ExternalTile({ tile }: { tile: Tile }) {
  const Icon = tile.icon;
  return (
    <a
      href={tile.href}
      target="_blank"
      rel="noopener noreferrer"
      className="relative w-[140px] sm:w-[160px] aspect-square bg-white border border-[#E6E2DC] rounded-2xl overflow-hidden flex flex-col items-center justify-center gap-1.5 transition-all hover:scale-[1.03] hover:shadow-lg"
    >
      <div className="absolute top-0 left-0 right-0 h-1" style={{ background: tile.accent }} />
      <Icon size={40} style={{ color: tile.accent }} />
      <div className="text-[15px] font-bold font-display text-ink text-center px-2">
        {tile.label}
      </div>
      <div className="text-[12px] text-ink-mid text-center px-3 leading-tight">
        {tile.subtitle}
      </div>
    </a>
  );
}
