'use client';

// FoxO — Portal Sidebar (calque sur components/Sidebar.tsx admin)
// Desktop : sidebar gauche 220px (sticky)
// Mobile  : header fixe en haut + bottom navigation iOS-style

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Home, ClipboardList, Calendar, Plus, type LucideIcon } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Logo } from '@/components/Logo';
import { ThemeToggle } from '@/components/ThemeToggle';
import { usePortalContext } from './PortalContext';

// ─── Styles inline (mêmes constantes que la sidebar admin) ─────────────
const S = {
  sidebar: {
    width: 220,
    minHeight: '100vh',
    background: 'linear-gradient(180deg, #0f1e35 0%, #1a3a5c 100%)',
    display: 'flex' as const,
    flexDirection: 'column' as const,
    flexShrink: 0,
    borderRight: '1px solid rgba(255,255,255,.04)',
    position: 'sticky' as const,
    top: 0,
    height: '100vh',
    overflowY: 'auto' as const,
  },
  logoZone: {
    background: 'rgba(0,0,0,0.20)',
    padding: '20px 16px 16px',
    display: 'flex' as const,
    flexDirection: 'column' as const,
    alignItems: 'center' as const,
    gap: 8,
    borderBottom: '1px solid rgba(255,255,255,0.08)',
    flexShrink: 0,
  },
  logoLabel: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.6)',
    textAlign: 'center' as const,
    fontWeight: 600,
    lineHeight: 1.3,
    wordBreak: 'break-word' as const,
  },
  nav: { padding: '14px 8px', flex: 1 },
  navItem: (active: boolean): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    paddingTop: 10,
    paddingRight: 12,
    paddingBottom: 10,
    paddingLeft: 9, // 12 - 3 (compense borderLeft 3px pour ne pas décaler le contenu)
    borderLeft: active ? '3px solid #60A5FA' : '3px solid transparent',
    borderRadius: 8,
    marginBottom: 4,
    fontSize: 11,
    fontWeight: active ? 600 : 500,
    color: active ? '#FFFFFF' : 'rgba(255,255,255,0.7)',
    background: active ? 'rgba(96,165,250,0.15)' : 'transparent',
    cursor: 'pointer',
    textDecoration: 'none',
    transition: 'all .15s',
  }),
  // Bouton accent "Nouvelle demande" — couleur dépend de orgType
  navItemAccent: (active: boolean, accent: string): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 12px',
    borderRadius: 8,
    marginTop: 8,
    fontSize: 13,
    fontWeight: 700,
    color: '#FFFFFF',
    background: accent,
    opacity: active ? 1 : 0.92,
    cursor: 'pointer',
    textDecoration: 'none',
    transition: 'all .15s',
    boxShadow: active ? '0 0 0 2px rgba(255,255,255,.12) inset' : undefined,
  }),
  footer: {
    padding: '12px 14px 14px',
    borderTop: '1px solid rgba(255,255,255,.05)',
    flexShrink: 0,
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: 8,
  },
  footerEmail: {
    fontSize: 10,
    color: '#8A8278',
    fontFamily: 'monospace',
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
    whiteSpace: 'nowrap' as const,
  },

  // ── Mobile bottom nav (visibilité via .foxo-portal-mobile / .foxo-portal-desktop) ──
  bottomNav: {
    position: 'fixed' as const,
    bottom: 0,
    left: 0,
    right: 0,
    background: 'linear-gradient(180deg, #0f1e35 0%, #1a3a5c 100%)',
    borderTop: '1px solid rgba(255,255,255,.08)',
    justifyContent: 'space-around' as const,
    alignItems: 'center' as const,
    padding: '8px 0',
    paddingBottom: 'env(safe-area-inset-bottom, 8px)',
    zIndex: 100,
  },
  bottomNavItem: (active: boolean): React.CSSProperties => ({
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 3,
    padding: '4px 12px',
    color: active ? '#60A5FA' : 'rgba(255,255,255,0.5)',
    textDecoration: 'none',
    fontSize: 10,
    fontWeight: active ? 700 : 500,
    minWidth: 48,
    minHeight: 44,
    justifyContent: 'center',
    transition: 'color .15s',
  }),
  bottomNavIcon: (active: boolean): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    opacity: active ? 1 : 0.7,
    transition: 'opacity .15s',
  }),
};

interface NavItem {
  href: string;
  icon: LucideIcon;
  label: string;
}

export function PortalNav() {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const { orgType, orgNom, orgEmail, vocab } = usePortalContext();

  const accent = orgType === 'courtier' ? '#1D6FA4' : '#1B3A6B';

  // 4 items principaux. Le dernier (Nouvelle demande) est rendu en bouton
  // accent ; les 3 autres en items neutres avec état actif.
  const NAV: NavItem[] = [
    { href: '/portal',               icon: Home,            label: 'Tableau de bord' },
    { href: '/portal/interventions', icon: ClipboardList,   label: vocab.interventionsCap },
    { href: '/portal/calendar',      icon: Calendar,        label: 'Planning' },
  ];

  // Bottom nav iOS — 3 ou 4 items selon orgType (l'item "Nouveau" est
  // masqué pour les experts qui n'ont pas le droit de créer une demande).
  const BOTTOM_NAV: NavItem[] = [
    { href: '/portal',               icon: Home,            label: 'Accueil' },
    { href: '/portal/interventions', icon: ClipboardList,   label: 'Interventions' },
    { href: '/portal/calendar',      icon: Calendar,        label: 'Planning' },
    ...(vocab.newRequestVerb
      ? [{ href: '/portal/nouveau', icon: Plus, label: 'Nouveau' } as NavItem]
      : []),
  ];

  const isActive = (href: string) =>
    href === '/portal' ? pathname === '/portal' : pathname.startsWith(href);

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push('/auth/login');
  }

  return (
    <>
      {/* ── DESKTOP sidebar ─────────────────────────────────────────────── */}
      <aside style={S.sidebar} className="foxo-portal-desktop">
        <div style={S.logoZone}>
          {/* Logo BLANC officiel — sidebar portal toujours sur fond navy
              (gradient #0f1e35 → #1a3a5c, cf. S.sidebar). */}
          <Logo size={90} variant="blanc" priority />
          <span style={S.logoLabel}>{orgNom || vocab.portalLabel}</span>
        </div>

        <nav style={S.nav}>
          {NAV.map((item) => {
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href} style={S.navItem(isActive(item.href))}>
                <Icon size={16} />
                <span>{item.label}</span>
              </Link>
            );
          })}
          {vocab.newRequestVerb && (
            <Link
              href="/portal/nouveau"
              style={S.navItemAccent(isActive('/portal/nouveau'), accent)}
            >
              <Plus size={16} />
              <span>{vocab.newRequestVerb.replace(/^\+\s*/, '')}</span>
            </Link>
          )}
        </nav>

        <div style={S.footer}>
          <span style={S.footerEmail} title={orgEmail}>{orgEmail}</span>
          <ThemeToggle className="foxo-theme-toggle-desktop" />
          <button
            onClick={handleLogout}
            style={{
              background: 'rgba(255,255,255,.05)',
              border: '1px solid rgba(255,255,255,.08)',
              borderRadius: 7,
              padding: '8px 10px',
              color: '#8A8278',
              fontSize: 11,
              cursor: 'pointer',
              fontFamily: 'inherit',
              width: '100%',
            }}
          >
            Déconnexion
          </button>
        </div>
      </aside>

      {/* ── MOBILE header fixe ──────────────────────────────────────────── */}
      <header className="foxo-portal-mobile-header">
        <Logo size={36} variant="blanc" />
        <span className="foxo-portal-mobile-header-label">{orgNom || vocab.portalLabel}</span>
        <ThemeToggle className="foxo-portal-theme-toggle-mobile" />
      </header>

      {/* ── MOBILE bottom nav ───────────────────────────────────────────── */}
      <nav style={S.bottomNav} className="foxo-portal-mobile">
        {BOTTOM_NAV.map((item) => {
          const active = isActive(item.href);
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href} style={S.bottomNavItem(active)}>
              <span style={S.bottomNavIcon(active)}><Icon size={18} /></span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* ── CSS responsive (calque sur la sidebar admin) ────────────────── */}
      <style>{`
        .foxo-portal-desktop        { display: flex; }
        .foxo-portal-mobile         { display: none; }
        .foxo-portal-mobile-header  { display: none; }

        .foxo-theme-toggle-desktop {
          width: 100%;
          height: 34px;
          border-radius: 7px;
          background: rgba(255,255,255,.06);
          border: 1px solid rgba(255,255,255,.1);
          color: #C8C2B8;
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          font-family: inherit;
        }
        .foxo-portal-theme-toggle-mobile { display: none; }

        @media (max-width: 1023px) {
          .foxo-portal-desktop { display: none !important; }
          .foxo-portal-mobile  { display: flex !important; }
          .foxo-portal-mobile-header {
            display: flex !important;
            position: fixed;
            top: 0; left: 0; right: 0;
            z-index: 80;
            background: var(--sidebar-logo-bg);
            border-bottom: 1px solid rgba(0,0,0,.12);
            padding: max(env(safe-area-inset-top, 8px), 8px) 16px 8px;
            align-items: center;
            justify-content: center;
            gap: 10px;
          }
          .foxo-portal-mobile-header-label {
            font-size: 10px;
            color: var(--sidebar-logo-fg);
            font-weight: 600;
            text-align: center;
          }
          .foxo-portal-theme-toggle-mobile {
            display: flex !important;
            position: absolute;
            right: 12px;
            top: 50%;
            transform: translateY(-50%);
            width: 36px;
            height: 36px;
            border-radius: 9px;
            background: rgba(28,26,22,.12);
            border: 1px solid rgba(28,26,22,.18);
            color: #2C2A24;
            font-size: 16px;
            cursor: pointer;
            align-items: center;
            justify-content: center;
            font-family: inherit;
          }
          /* Espace pour le header fixe en haut + la bottom nav en bas */
          main {
            padding-top: calc(80px + env(safe-area-inset-top, 0px)) !important;
            padding-bottom: calc(90px + env(safe-area-inset-bottom, 0px)) !important;
          }
        }

        /* Hover desktop */
        @media (hover: hover) {
          .foxo-portal-desktop a:hover {
            background: rgba(255,255,255,.04);
            color: #F0ECE4;
          }
          .foxo-theme-toggle-desktop:hover {
            background: rgba(255,255,255,.12) !important;
            color: #F0ECE4 !important;
          }
        }
      `}</style>
    </>
  );
}
