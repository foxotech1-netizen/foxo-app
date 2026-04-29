import Image from 'next/image';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

interface Tile {
  href: string;
  icon: string;
  title: string;
  subtitle?: string;
  bg: string;
  badgeCount?: number;
}

export default async function HomePage() {
  const supabase = await createClient();
  const { data: ivs } = await supabase
    .from('interventions')
    .select('statut, technicien_id');
  const alertCount = (ivs ?? []).filter(
    (i) => i.statut === 'en_suspens' || (i.statut === 'nouvelle' && !i.technicien_id),
  ).length;

  // Palette FoxO par section, cohérente avec sidebar / badges existants
  const tiles: Tile[] = [
    { href: '/admin',             icon: '📊', title: 'Tableau de bord', subtitle: 'Vue opérationnelle',  bg: '#1B3A6B' },
    { href: '/admin/alertes',     icon: '🔔', title: 'Alertes',          subtitle: alertCount > 0 ? `${alertCount} en attente` : 'Tout est OK', bg: '#C4622D', badgeCount: alertCount },
    { href: '/admin/planning',    icon: '📅', title: 'Planning',         subtitle: 'Créneaux & RDV',     bg: '#1F6B45' },
    { href: '/admin/assistant',   icon: '✨', title: 'Assistant IA',     subtitle: 'Claude FoxO',        bg: '#A17244' },
    { href: '/admin/syndics',     icon: '👥', title: 'Syndics',          subtitle: 'Partenaires',        bg: '#1B3A6B' },
    { href: '/admin/clients',     icon: '👤', title: 'Clients',          subtitle: 'Base contacts',      bg: '#1F6B45' },
    { href: '/admin/facturation', icon: '🧾', title: 'Facturation',      subtitle: 'Factures émises',    bg: '#A17244' },
    { href: '/admin/articles',    icon: '📦', title: 'Catalogue',        subtitle: 'Prestations',        bg: '#3D3A32' },
    { href: '/admin/mails',       icon: '✉️', title: 'Mails',            subtitle: 'Boîte FoxO',         bg: '#1B3A6B' },
    { href: '/admin/parametres',  icon: '⚙️', title: 'Paramètres',       subtitle: 'Configuration',      bg: '#3D3A32' },
  ];

  return (
    <div className="foxo-home-root">
      <div className="foxo-home-logo-zone">
        <Image
          src="/foxo-logo-noir-transparent.png"
          alt="FoxO"
          width={72}
          height={72}
          style={{ objectFit: 'contain' }}
          priority
        />
        <span className="foxo-home-logo-label">FoxO · Interface Admin</span>
      </div>

      <div className="foxo-home-grid-wrap">
        <div className="foxo-home-grid">
          {tiles.map((t) => (
            <Link key={t.href} href={t.href} className="foxo-home-tile" style={{ background: t.bg }}>
              {t.badgeCount && t.badgeCount > 0 ? (
                <span className="foxo-home-tile-badge">{t.badgeCount}</span>
              ) : null}
              <span className="foxo-home-tile-icon">{t.icon}</span>
              <span className="foxo-home-tile-title">{t.title}</span>
              {t.subtitle && (
                <span className="foxo-home-tile-subtitle">{t.subtitle}</span>
              )}
            </Link>
          ))}
        </div>
      </div>

      <style>{`
        .foxo-home-root {
          min-height: 100vh;
          background: linear-gradient(180deg, #2C2A24 0%, #1A1814 100%);
          display: flex;
          flex-direction: column;
          align-items: stretch;
          width: 100%;
        }
        .foxo-home-logo-zone {
          background: #E2C9A1;
          padding: 32px 16px 24px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 10px;
          border-bottom: 1px solid rgba(0,0,0,.12);
        }
        .foxo-home-logo-label {
          font-size: 11px;
          color: #7A6A50;
          text-transform: uppercase;
          letter-spacing: .18em;
          font-weight: 700;
          font-family: var(--font-sans);
        }
        .foxo-home-grid-wrap {
          flex: 1;
          display: flex;
          align-items: flex-start;
          justify-content: center;
          padding: 48px 24px;
        }
        .foxo-home-grid {
          display: grid;
          grid-template-columns: repeat(4, 120px);
          gap: 18px;
          justify-content: center;
        }
        .foxo-home-tile {
          position: relative;
          width: 120px;
          height: 120px;
          border-radius: 16px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 4px;
          color: #FFFFFF;
          text-decoration: none;
          font-family: var(--font-sans);
          box-shadow: 0 4px 12px rgba(0,0,0,.25);
          transition: transform .18s ease, box-shadow .18s ease, filter .18s ease;
          padding: 8px;
          text-align: center;
        }
        .foxo-home-tile-icon {
          font-size: 36px;
          line-height: 1;
          margin-bottom: 4px;
        }
        .foxo-home-tile-title {
          font-size: 13px;
          font-weight: 700;
          color: #FFFFFF;
          letter-spacing: .01em;
          line-height: 1.15;
        }
        .foxo-home-tile-subtitle {
          font-size: 11px;
          color: rgba(255,255,255,.7);
          line-height: 1.2;
          margin-top: 2px;
        }
        .foxo-home-tile-badge {
          position: absolute;
          top: 8px;
          right: 8px;
          min-width: 22px;
          height: 22px;
          padding: 0 6px;
          background: #E53935;
          color: #FFFFFF;
          border-radius: 11px;
          font-size: 11px;
          font-weight: 800;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 2px 6px rgba(0,0,0,.4);
        }

        @media (hover: hover) {
          .foxo-home-tile:hover {
            transform: translateY(-3px);
            box-shadow: 0 12px 28px rgba(0,0,0,.4);
            filter: brightness(1.1);
          }
        }
        .foxo-home-tile:active {
          transform: scale(0.95);
          box-shadow: 0 4px 10px rgba(0,0,0,.35);
        }

        @media (max-width: 640px) {
          .foxo-home-grid {
            grid-template-columns: repeat(3, 100px);
            gap: 12px;
          }
          .foxo-home-tile {
            width: 100px;
            height: 100px;
            border-radius: 14px;
            padding: 6px;
          }
          .foxo-home-tile-icon { font-size: 30px; }
          .foxo-home-tile-title { font-size: 11px; }
          .foxo-home-tile-subtitle { font-size: 9px; }
          .foxo-home-grid-wrap { padding: 24px 12px 32px; }
          .foxo-home-logo-zone { padding: 24px 16px 18px; }
        }
      `}</style>
    </div>
  );
}
