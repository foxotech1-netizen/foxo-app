// components/Sidebar.tsx
// FoxO — Sidebar Admin
// Desktop : sidebar gauche 220px
// Mobile : bottom navigation bar

'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { ThemeToggle } from '@/components/ThemeToggle'
import { ThemeSelector } from '@/components/ThemeSelector'

const NAV_MAIN = [
  { href: '/admin/home',        icon: '⊞', label: 'Accueil'         },
  { href: '/admin',             icon: '📊', label: 'Tableau de bord' },
  { href: '/admin/alertes',     icon: '🔔', label: 'Alertes', badge: true },
  { href: '/admin/planning',    icon: '📅', label: 'Planning'    },
  { href: '/admin/techniciens', icon: '🔧', label: 'Techniciens' },
  { href: '/admin/assistant',   icon: '✨', label: 'Assistant'   },
]

// NAV_GESTION ne contient PLUS Syndics — celui-ci est désormais le 1er
// élément du menu dépliable "🤝 Partenaires" (rendu séparément avant
// la map ci-dessous).
const NAV_GESTION = [
  { href: '/admin/clients',      icon: '👤', label: 'Clients'       },
  // /admin/comptabilite redirige vers /admin/facturation (cf. page.tsx
  // dédiée). Le label "Comptabilité" reflète mieux le périmètre actuel
  // (factures + devis + avoirs + paiements + rappels + export comptable).
  { href: '/admin/comptabilite', icon: '📒', label: 'Comptabilité'  },
  { href: '/admin/mails',        icon: '✉',  label: 'Mails'        },
  { href: '/admin/utilisateurs', icon: '🔐', label: 'Utilisateurs'  },
  { href: '/admin/parametres',   icon: '⊙',  label: 'Paramètres'   },
]

// Sous-items du menu Partenaires — chaque item pointe vers une page
// /admin/{slug} qui affiche les organisations filtrées par type.
const PARTENAIRES_SUB = [
  { href: '/admin/syndics',   icon: '🏢', label: 'Syndics'   },
  { href: '/admin/courtiers', icon: '⚖️', label: 'Courtiers' },
  { href: '/admin/experts',   icon: '🔍', label: 'Experts'   },
  { href: '/admin/metiers',   icon: '🔨', label: 'Métiers'   },
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
    fontWeight: active ? 600 : 500,
    color: active ? '#F0ECE4' : '#C8C2B8',
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
  // Footer (sticky bottom : ThemeSelector + Déconnexion)
  footer: {
    padding: '10px 14px 14px',
    borderTop: '1px solid rgba(255,255,255,.05)',
    flexShrink: 0,
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: 6,
  },

  // ── MOBILE bottom nav ──────────────────────────────────────────────────────
  // Visibilité gérée via la classe `.foxo-sidebar-mobile` :
  //   default desktop : display: none
  //   @media max-width 768px : display: flex !important
  // On NE met PAS `display` ici en inline pour que la classe CSS gagne.
  bottomNav: {
    position: 'fixed' as const,
    bottom: 0,
    left: 0,
    right: 0,
    background: 'linear-gradient(180deg, #2C2A24 0%, #1A1814 100%)',
    borderTop: '1px solid #E2C9A1',
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
    color: active ? '#E2C9A1' : '#C8C2B8',
    textDecoration: 'none',
    fontSize: 10,
    fontWeight: active ? 700 : 500,
    minWidth: 48,
    minHeight: 44,
    justifyContent: 'center',
    position: 'relative' as const,
    transition: 'color .15s',
  }),
  bottomNavIcon: (active: boolean): React.CSSProperties => ({
    fontSize: 18,
    opacity: active ? 1 : 0.7,
    transition: 'opacity .15s',
  }),
}

// ─── Composant ─────────────────────────────────────────────────────────────────
export default function Sidebar({
  alertCount = 0,
  recentResponsesCount = 0,
}: {
  alertCount?: number
  recentResponsesCount?: number
}) {
  const pathname = usePathname()
  const router   = useRouter()
  const supabase = createClient()

  // Menu Partenaires : ouvert par défaut si on est déjà sur une de ses
  // sous-pages (lazy init useState — pas de useEffect → pas de souci
  // avec react-hooks/set-state-in-effect).
  const [partenairesOpen, setPartenairesOpen] = useState(
    pathname.startsWith('/admin/syndics')   ||
    pathname.startsWith('/admin/courtiers') ||
    pathname.startsWith('/admin/experts')   ||
    pathname.startsWith('/admin/metiers')
  )

  // Badge unread mails (Gmail) — fetch lazy une fois monté côté client
  const [unreadMails, setUnreadMails] = useState<number>(0)
  useEffect(() => {
    let cancelled = false
    fetch('/api/admin/mails/unread-count', { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (!cancelled && data?.ok) setUnreadMails(data.count ?? 0)
      })
      .catch(() => { /* ignoré (Google non connecté = silent) */ })
    return () => { cancelled = true }
  }, [])

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  const isActive = (href: string) => {
    // Cas spéciaux : /admin (exact match pour éviter de match toutes les
    // sous-routes), et /admin/comptabilite qui redirige vers /admin/
    // facturation — on highlight l'item Comptabilité sur les 2 paths.
    if (href === '/admin') return pathname === '/admin'
    if (href === '/admin/comptabilite') {
      return pathname.startsWith('/admin/comptabilite')
        || pathname.startsWith('/admin/facturation')
    }
    return pathname.startsWith(href)
  }

  // ── Mobile bottom nav — 5 items fixes ───────────────────────────────────────
  const BOTTOM_NAV = [
    { href: '/admin',           icon: '📊', label: 'Tableau'   },
    { href: '/admin/alertes',   icon: '🔔', label: 'Alertes'   },
    { href: '/admin/planning',  icon: '📅', label: 'Planning'  },
    { href: '/admin/assistant', icon: '✨', label: 'Assistant' },
    { href: '/admin/home',      icon: '⊞',  label: 'Menu'      },
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
            // brightness-0 invert : logo noir → blanc. Les 3 thèmes
            // (dark-amber / warm-light / foxo-blue) ont tous une
            // sidebar sombre, donc filtre toujours appliqué.
            className="brightness-0 invert"
            style={{ objectFit: 'contain' }}
            priority
          />
          <span style={S.logoLabel}>Interface Admin</span>
        </div>

        {/* Nav principale */}
        <nav style={S.nav}>
          {NAV_MAIN.map(item => (
            <Link
              key={item.href}
              href={item.href === '/admin' && recentResponsesCount > 0
                ? '/admin?recent_responses=1'
                : item.href}
              style={S.navItem(isActive(item.href))}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </span>
              {item.badge && alertCount > 0 && (
                <span style={S.badge}>{alertCount}</span>
              )}
              {item.href === '/admin' && recentResponsesCount > 0 && (
                <span
                  style={S.badge}
                  title="Réponses occupants reçues (< 48 h)"
                >📬 {recentResponsesCount}</span>
              )}
            </Link>
          ))}

          <div style={S.divider} />

          {/* Partenaires — menu dépliable avec 4 sous-items */}
          <div>
            <button
              type="button"
              onClick={() => setPartenairesOpen(v => !v)}
              style={{
                ...S.navItem(false),
                width: '100%',
                border: 'none',
                cursor: 'pointer',
                fontFamily: 'inherit',
                textAlign: 'left',
                background: PARTENAIRES_SUB.some(s => isActive(s.href))
                  ? 'rgba(255,255,255,.05)'
                  : 'transparent',
              }}
              aria-expanded={partenairesOpen}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <span>🤝</span>
                <span>Partenaires</span>
              </span>
              <span style={{ fontSize: 10, opacity: 0.7 }}>
                {partenairesOpen ? '▾' : '▸'}
              </span>
            </button>
            {partenairesOpen && (
              <div>
                {PARTENAIRES_SUB.map(sub => (
                  <Link
                    key={sub.href}
                    href={sub.href}
                    style={{
                      ...S.navItem(isActive(sub.href)),
                      padding: '7px 12px 7px 32px',
                      fontSize: 12,
                    }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                      <span>{sub.icon}</span>
                      <span>{sub.label}</span>
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {NAV_GESTION.map(item => (
            <Link key={item.href} href={item.href} style={S.navItem(isActive(item.href))}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </span>
              {item.href === '/admin/mails' && unreadMails > 0 && (
                <span style={S.badge}>{unreadMails}</span>
              )}
            </Link>
          ))}
        </nav>

        {/* Footer : thème + déconnexion */}
        <div style={S.footer}>
          <ThemeSelector className="foxo-theme-selector" />
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

      {/* ── MOBILE : header fixe en haut avec logo + toggle thème ─────────── */}
      <header className="foxo-mobile-header">
        <Image
          src="/foxo-logo-noir-transparent.png"
          alt="FoxO"
          width={36}
          height={36}
          className="brightness-0 invert"
          style={{ objectFit: 'contain' }}
        />
        <span className="foxo-mobile-header-label">Interface Admin</span>
        <ThemeToggle className="foxo-theme-toggle-mobile" />
      </header>

      {/* ── MOBILE bottom nav ────────────────────────────────────────────────── */}
      <nav style={S.bottomNav} className="foxo-sidebar-mobile">
        {BOTTOM_NAV.map(item => {
          const active = isActive(item.href)
          return (
          <Link key={item.href} href={item.href} style={S.bottomNavItem(active)}>
            <span style={S.bottomNavIcon(active)}>{item.icon}</span>
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
          )
        })}
      </nav>

      {/* ── CSS responsive ──────────────────────────────────────────────────── */}
      <style>{`
        .foxo-sidebar-desktop { display: flex; }
        .foxo-sidebar-mobile  { display: none; }
        .foxo-mobile-header   { display: none; }

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
            background: var(--sidebar-logo-bg);
            border-bottom: 1px solid rgba(0,0,0,.12);
            padding: max(env(safe-area-inset-top, 8px), 8px) 16px 8px;
            align-items: center;
            justify-content: center;
            gap: 10px;
          }
          .foxo-mobile-header-label {
            font-size: 9px;
            color: var(--sidebar-logo-fg);
            text-transform: uppercase;
            letter-spacing: .15em;
            font-weight: 600;
          }
          .foxo-theme-toggle-mobile {
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
          /* Espace pour le header fixe en haut (#E2C9A1 + logo + label)
             et la bottom nav en bas. Marge confortable au-dessus de la
             nav (90px = 64 nav + 26 padding) pour que les boutons d'action
             ne soient jamais collés. */
          main {
            padding-top: calc(80px + env(safe-area-inset-top, 0px)) !important;
            padding-bottom: calc(90px + env(safe-area-inset-bottom, 0px)) !important;
          }
        }

        /* Hover desktop */
        @media (hover: hover) {
          .foxo-sidebar-desktop a:hover {
            background: rgba(255,255,255,.07) !important;
            color: #F0ECE4 !important;
          }
          .foxo-theme-toggle-desktop:hover {
            background: rgba(255,255,255,.12) !important;
            color: #F0ECE4 !important;
          }
        }
      `}</style>
    </>
  )
}
