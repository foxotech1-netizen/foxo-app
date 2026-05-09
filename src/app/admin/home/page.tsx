import Link from 'next/link';
import {
  BarChart3, Bell, Calendar, Wrench, Sparkles, Users, User,
  Receipt, Package, Mail, Settings, type LucideIcon,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Logo } from '@/components/Logo';

export const dynamic = 'force-dynamic';

interface Tile {
  href: string;
  Icon: LucideIcon;
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
    { href: '/admin',             Icon: BarChart3, title: 'Tableau de bord', subtitle: 'Vue opérationnelle',  bg: '#1B3A6B' },
    { href: '/admin/alertes',     Icon: Bell,      title: 'Alertes',          subtitle: alertCount > 0 ? `${alertCount} en attente` : 'Tout est OK', bg: '#C4622D', badgeCount: alertCount },
    { href: '/admin/planning',    Icon: Calendar,  title: 'Planning',         subtitle: 'Créneaux & RDV',     bg: '#1F6B45' },
    { href: '/admin/techniciens', Icon: Wrench,    title: 'Techniciens',      subtitle: 'Équipe terrain',     bg: '#3D3A32' },
    { href: '/admin/assistant',   Icon: Sparkles,  title: 'Assistant IA',     subtitle: 'Claude FoxO',        bg: '#A17244' },
    { href: '/admin/syndics',     Icon: Users,     title: 'Syndics',          subtitle: 'Partenaires',        bg: '#1B3A6B' },
    { href: '/admin/clients',     Icon: User,      title: 'Clients',          subtitle: 'Base contacts',      bg: '#1F6B45' },
    { href: '/admin/facturation', Icon: Receipt,   title: 'Facturation',      subtitle: 'Factures émises',    bg: '#A17244' },
    { href: '/admin/articles',    Icon: Package,   title: 'Catalogue',        subtitle: 'Prestations',        bg: '#3D3A32' },
    { href: '/admin/mails',       Icon: Mail,      title: 'Mails',            subtitle: 'Boîte FoxO',         bg: '#1B3A6B' },
    { href: '/admin/parametres',  Icon: Settings,  title: 'Paramètres',       subtitle: 'Configuration',      bg: '#3D3A32' },
  ];

  return (
    <div className="foxo-home-root">
      <div className="foxo-home-logo-zone">
        {/* Logo NOIR — fond hero clair (var(--hero-bg), sand chaud). */}
        <Logo size={72} variant="noir" priority />
        <span className="section-label">FoxO · Interface Admin</span>
      </div>

      <div className="foxo-home-grid-wrap">
        <div className="foxo-home-grid">
          {tiles.map((t) => (
            <Link key={t.href} href={t.href} className="foxo-home-tile">
              {t.badgeCount && t.badgeCount > 0 ? (
                <span className="foxo-home-tile-badge">{t.badgeCount}</span>
              ) : null}
              <span
                className="foxo-home-tile-icon-box"
                style={{ background: `${t.bg}26` }}
              >
                <t.Icon size={22} color={t.bg} aria-hidden />
              </span>
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
          background: var(--card-bg);
          display: flex;
          flex-direction: column;
          align-items: stretch;
          width: 100%;
        }
        .foxo-home-logo-zone {
          background: var(--hero-bg);
          padding: 32px 16px 24px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 10px;
          border-bottom: 1px solid rgba(0,0,0,.12);
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
          text-decoration: none;
          font-family: var(--font-sans);
          background: var(--card-bg);
          border: 1px solid var(--card-border);
          box-shadow: var(--card-shadow);
          transition: transform .18s ease, box-shadow .18s ease;
          padding: 10px;
          text-align: center;
        }
        .foxo-home-tile-icon-box {
          width: 44px;
          height: 44px;
          border-radius: 10px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .foxo-home-tile-title {
          font-family: var(--font-syne), ui-sans-serif, system-ui, sans-serif;
          font-size: 13px;
          font-weight: 700;
          color: var(--text-primary);
          letter-spacing: -0.01em;
          line-height: 1.15;
        }
        .foxo-home-tile-subtitle {
          font-size: 11px;
          color: var(--text-secondary);
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
            box-shadow: var(--card-shadow-hover);
          }
        }
        .foxo-home-tile:active {
          transform: scale(0.95);
          box-shadow: var(--card-shadow);
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
            padding: 8px;
          }
          .foxo-home-tile-title { font-size: 11px; }
          .foxo-home-tile-subtitle { font-size: 9px; }
          .foxo-home-grid-wrap { padding: 24px 12px 32px; }
          .foxo-home-logo-zone { padding: 24px 16px 18px; }
        }
      `}</style>
    </div>
  );
}
