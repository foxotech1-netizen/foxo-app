// components/Sidebar.tsx
// FoxO — Sidebar Admin
// Desktop : sidebar gauche 220px
// Mobile : bottom navigation bar

'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { ThemeToggle } from '@/components/ThemeToggle'

const NAV_MAIN = [
  { href: '/admin',           icon: '▦', label: 'Pipeline'    },
  { href: '/admin/alertes',   icon: '◉', label: 'Alertes',  badge: true },
  { href: '/admin/planning',  icon: '▷', label: 'Planning'    },
  { href: '/admin/assistant', icon: '✨', label: 'Assistant'   },
]

const NAV_GESTION = [
  { href: '/admin/syndics',    icon: '👥', label: 'Syndics'    },
  { href: '/admin/mails',      icon: '✉',  label: 'Mails'      },
  { href: '/admin/parametres', icon: '⊙',  label: 'Paramètres' },
]

const TECHNICIENS = [
  { initiales: 'CM', nom: 'C. Mertens' },
  { initiales: 'TR', nom: 'T. Renard'  },
]

// ─── Styles inline (pas de Tailwind JIT requis) ────────────────────────────────
const S = {
  // Desktop sidebar
  sidebar: {
    width: 220,
    minHeight: '100vh',
    background: 'var(--sidebar-bg)',
    display: 'flex' as const,
    flexDirection: 'column' as const,
    flexShrink: 0,
    borderRight: '1px solid rgba(255,255,255,.04)',
    position: 'sticky' as const,
    top: 0,
    height: '100vh',
    overflowY: 'auto' as const,
  },
  // Zone logo
  logoZone: {
    background: 'var(--sidebar-logo-bg)',
    padding: '20px 16px 16px',
    display: 'flex' as const,
    flexDirection: 'column' as const,
    alignItems: 'center' as const,
    gap: 8,
    borderBottom: '1px solid rgba(0,0,0,.12)',
    flexShrink: 0,
  },
  logoLabel: {
    fontSize: 9,
    color: 'var(--sidebar-logo-fg)',
    textTransform: 'uppercase' as const,
    letterSpacing: '.15em',
    fontWeight: 600,
  },
  // Nav
  nav: { padding: '10px 8px', flex: 1 },
  sectionLabel: {
    fontSize: 9,
    color: '#5A5650',
    textTransform: 'uppercase' as const,
    letterSpacing: '.1em',
    fontWeight: 700,
    margin: '4px 10px 6px',
  },
  divider: {
    height: 1,
    background: 'rgba(255,255,255,.06)',
    margin: '6px 10px',
  },
  navItem: (active: boolean): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: 9,
    padding: '9px 12px',
    borderRadius: 8,
    marginBottom: 2,
    fontSize: 13,
    fontWeight: active ? 600 : 400,
    color: active ? '#F0ECE4' : '#8A8278',
    background: active ? 'rgba(255,255,255,.09)' : 'transparent',
    cursor: 'pointer',
    textDecoration: 'none',
    transition: 'all .15s',
    justifyContent: 'space-between' as const,
  }),
  badge: {
    background: '#C4622D',
    color: '#fff',
    borderRadius: 20,
    fontSize: 10,
    fontWeight: 700,
    padding: '1px 7px',
    marginLeft: 'auto',
  },
  // Techniciens
  techSection: {
    padding: '10px 14px 14px',
    borderTop: '1px solid rgba(255,255,255,.05)',
    flexShrink: 0,
  },
  techRow: {
    display: 'flex' as const,
    alignItems: 'center' as const,
    gap: 9,
    padding: '4px 0',
  },
  techAvatar: {
    width: 26,
    height: 26,
    borderRadius: '50%',
    background: '#3D3A32',
    color: '#C0BAB0',
    display: 'flex' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    fontSize: 10,
    fontWeight: 700,
    flexShrink: 0,
  },
  techName: { fontSize: 11, fontWeight: 600, color: '#C0BAB0' },
  techSub:  { fontSize: 10, color: '#5A5650', marginTop: 1 },

  // ── MOBILE bottom nav ──────────────────────────────────────────────────────
  bottomNav: {
    position: 'fixed' as const,
    bottom: 0,
    left: 0,
    right: 0,
    background: 'var(--sidebar-bg)',
    borderTop: '1px solid rgba(255,255,255,.08)',
    display: 'flex' as const,
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
    padding: '4px 16px',
    color: active ? '#E2C9A1' : '#5A5650',
    textDecoration: 'none',
    fontSize: 10,
    fontWeight: active ? 600 : 400,
    minWidth: 48,
    minHeight: 44,
    justifyContent: 'center',
    position: 'relative' as const,
  }),
  bottomNavIcon: { fontSize: 18 },
}

// ─── Composant ─────────────────────────────────────────────────────────────────
export default function Sidebar({ alertCount = 0 }: { alertCount?: number }) {
  const pathname = usePathname()
  const router   = useRouter()
  const supabase = createClient()

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  const isActive = (href: string) =>
    href === '/admin' ? pathname === '/admin' : pathname.startsWith(href)

  // ── Mobile bottom nav ───────────────────────────────────────────────────────
  const BOTTOM_NAV = [
    { href: '/admin',           icon: '▦', label: 'Pipeline'  },
    { href: '/admin/alertes',   icon: '◉', label: 'Alertes'   },
    { href: '/admin/planning',  icon: '▷', label: 'Planning'  },
    { href: '/admin/assistant', icon: '✨', label: 'Assistant' },
    { href: '/admin/syndics',   icon: '👥', label: 'Syndics'  },
  ]

  return (
    <>
      {/* ── DESKTOP sidebar ─────────────────────────────────────────────────── */}
      <aside style={S.sidebar} className="foxo-sidebar-desktop">
        {/* Logo */}
        <div style={S.logoZone}>
          <Image
            src="/foxo-logo-noir-transparent.png"
            alt="FoxO"
            width={90}
            height={90}
            style={{ objectFit: 'contain' }}
            priority
          />
          <span style={S.logoLabel}>Interface Admin</span>
        </div>

        {/* Nav principale */}
        <nav style={S.nav}>
          {NAV_MAIN.map(item => (
            <Link key={item.href} href={item.href} style={S.navItem(isActive(item.href))}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </span>
              {item.badge && alertCount > 0 && (
                <span style={S.badge}>{alertCount}</span>
              )}
            </Link>
          ))}

          <div style={S.divider} />

          {NAV_GESTION.map(item => (
            <Link key={item.href} href={item.href} style={S.navItem(isActive(item.href))}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </span>
            </Link>
          ))}
        </nav>

        {/* Techniciens */}
        <div style={S.techSection}>
          <div style={S.sectionLabel}>Techniciens</div>
          {TECHNICIENS.map(t => (
            <div key={t.initiales} style={S.techRow}>
              <div style={S.techAvatar}>{t.initiales}</div>
              <div>
                <div style={S.techName}>{t.nom}</div>
                <div style={S.techSub}>En ligne</div>
              </div>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
            <button
              onClick={handleLogout}
              style={{
                flex: 1,
                background: 'rgba(255,255,255,.05)',
                border: '1px solid rgba(255,255,255,.08)',
                borderRadius: 7,
                padding: '7px 10px',
                color: '#5A5650',
                fontSize: 11,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Déconnexion
            </button>
            <ThemeToggle
              className="foxo-theme-toggle-desktop"
            />
          </div>
        </div>
      </aside>

      {/* ── MOBILE : header fixe en haut avec logo ──────────────────────────── */}
      <header className="foxo-mobile-header">
        <Image
          src="/foxo-logo-noir-transparent.png"
          alt="FoxO"
          width={36}
          height={36}
          style={{ objectFit: 'contain' }}
        />
        <span className="foxo-mobile-header-label">Interface Admin</span>
      </header>

      {/* ── MOBILE : toggle thème flottant en haut à droite ─────────────────── */}
      <ThemeToggle className="foxo-theme-toggle-mobile" />

      {/* ── MOBILE bottom nav ────────────────────────────────────────────────── */}
      <nav style={S.bottomNav} className="foxo-sidebar-mobile">
        {BOTTOM_NAV.map(item => (
          <Link key={item.href} href={item.href} style={S.bottomNavItem(isActive(item.href))}>
            <span style={S.bottomNavIcon}>{item.icon}</span>
            <span>{item.label}</span>
            {item.href === '/admin/alertes' && alertCount > 0 && (
              <span style={{
                position: 'absolute',
                top: 6,
                right: '50%',
                transform: 'translateX(8px)',
                background: '#C4622D',
                color: '#fff',
                borderRadius: 20,
                fontSize: 9,
                fontWeight: 700,
                padding: '0 5px',
                minWidth: 16,
                textAlign: 'center',
              }}>{alertCount}</span>
            )}
          </Link>
        ))}
      </nav>

      {/* ── CSS responsive ──────────────────────────────────────────────────── */}
      <style>{`
        .foxo-sidebar-desktop { display: flex; }
        .foxo-sidebar-mobile  { display: none; }
        .foxo-mobile-header   { display: none; }

        .foxo-theme-toggle-desktop {
          width: 32px;
          height: 32px;
          border-radius: 7px;
          background: rgba(255,255,255,.05);
          border: 1px solid rgba(255,255,255,.08);
          color: var(--color-ink);
          font-size: 14px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          font-family: inherit;
        }
        .foxo-theme-toggle-mobile {
          display: none;
        }

        @media (max-width: 768px) {
          .foxo-sidebar-desktop { display: none !important; }
          .foxo-sidebar-mobile  { display: flex !important; }
          .foxo-mobile-header {
            display: flex !important;
            position: fixed;
            top: 0; left: 0; right: 0;
            z-index: 80;
            background: #E2C9A1;
            border-bottom: 1px solid rgba(0,0,0,.12);
            padding: max(env(safe-area-inset-top, 8px), 8px) 16px 8px;
            align-items: center;
            justify-content: center;
            gap: 10px;
          }
          .foxo-mobile-header-label {
            font-size: 9px;
            color: #7A6A50;
            text-transform: uppercase;
            letter-spacing: .15em;
            font-weight: 600;
          }
          .foxo-theme-toggle-mobile {
            display: flex !important;
            position: fixed;
            top: calc(env(safe-area-inset-top, 0px) + 10px);
            right: 12px;
            width: 38px;
            height: 38px;
            border-radius: 9px;
            background: rgba(28,26,22,.85);
            border: 1px solid rgba(255,255,255,.1);
            color: #F0ECE4;
            font-size: 16px;
            cursor: pointer;
            align-items: center;
            justify-content: center;
            z-index: 90;
            backdrop-filter: blur(6px);
            -webkit-backdrop-filter: blur(6px);
            font-family: inherit;
          }
          /* Espace pour le header fixe en haut (#E2C9A1 + logo + label)
             et la bottom nav en bas */
          main {
            padding-top: calc(70px + env(safe-area-inset-top, 0px)) !important;
            padding-bottom: calc(64px + env(safe-area-inset-bottom, 0px)) !important;
          }
        }

        /* Hover desktop */
        @media (hover: hover) {
          .foxo-sidebar-desktop a:hover {
            background: rgba(255,255,255,.05) !important;
            color: #C8C2B8 !important;
          }
          .foxo-theme-toggle-desktop:hover {
            background: rgba(255,255,255,.1) !important;
          }
        }
      `}</style>
    </>
  )
}
