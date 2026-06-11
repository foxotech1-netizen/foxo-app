// components/Sidebar.tsx
// FoxO — Sidebar Admin
// Desktop : sidebar gauche 220px
// Mobile : bottom navigation bar

'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Logo } from '@/components/Logo'
import {
  BarChart3, Bell, Calendar, Wrench, Sparkles,
  Handshake, Building2, Scale, Search, Hammer,
  User, BookOpen, Mail, Lock, Settings, Inbox,
  Activity, ClipboardCheck,
  type LucideIcon,
} from 'lucide-react'

interface NavItem { href: string; Icon: LucideIcon; label: string; badge?: boolean }

const NAV_MAIN: NavItem[] = [
  // Item "Accueil" supprimé Sprint 1 — la page /admin/home a été retirée
  // au profit du Tableau de bord adaptive qui intègre désormais le
  // briefing IA + les missions du jour en tête de page.
  { href: '/admin',             Icon: BarChart3,   label: 'Tableau de bord' },
  { href: '/admin/alertes',     Icon: Bell,        label: 'Alertes', badge: true },
  { href: '/admin/validation',  Icon: ClipboardCheck, label: 'À valider', badge: true },
  { href: '/admin/observabilite', Icon: Activity,  label: 'Observabilité' },
  { href: '/admin/planning',    Icon: Calendar,    label: 'Planning'    },
  { href: '/admin/techniciens', Icon: Wrench,      label: 'Techniciens' },
  { href: '/admin/assistant',   Icon: Sparkles,    label: 'Assistant'   },
]

// NAV_GESTION ne contient PLUS Syndics — celui-ci est désormais le 1er
// élément du menu dépliable "Partenaires" (rendu séparément avant
// la map ci-dessous).
const NAV_GESTION: NavItem[] = [
  { href: '/admin/clients',      Icon: User,     label: 'Clients'       },
  // /admin/comptabilite redirige vers /admin/facturation (cf. page.tsx
  // dédiée). Le label "Comptabilité" reflète mieux le périmètre actuel
  // (factures + devis + avoirs + paiements + rappels + export comptable).
  { href: '/admin/comptabilite', Icon: BookOpen, label: 'Comptabilité'  },
  { href: '/admin/mails',        Icon: Mail,     label: 'Mails'         },
  { href: '/admin/utilisateurs', Icon: Lock,     label: 'Utilisateurs'  },
  { href: '/admin/parametres',   Icon: Settings, label: 'Paramètres'    },
]

// Sous-items du menu Partenaires — chaque item pointe vers une page
// /admin/{slug} qui affiche les organisations filtrées par type.
const PARTENAIRES_SUB: NavItem[] = [
  { href: '/admin/syndics',   Icon: Building2, label: 'Syndics'   },
  { href: '/admin/courtiers', Icon: Scale,     label: 'Courtiers' },
  { href: '/admin/experts',   Icon: Search,    label: 'Experts'   },
  { href: '/admin/metiers',   Icon: Hammer,    label: 'Métiers'   },
]

// ─── Styles inline (pas de Tailwind JIT requis) ────────────────────────────────
const S = {
  // Desktop sidebar — gradient navy FoxO fixe (calque sur PortalNav).
  sidebar: {
    width: 220,
    minHeight: '100vh',
    background: 'linear-gradient(180deg, var(--color-navy-dark) 0%, var(--color-navy-deep) 100%)',
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
    padding: '20px 16px 16px',
    display: 'flex' as const,
    flexDirection: 'column' as const,
    alignItems: 'center' as const,
    gap: 8,
    borderBottom: '1px solid rgba(255,255,255,.08)',
    flexShrink: 0,
  },
  logoLabel: {
    fontSize: 9,
    color: 'rgba(253, 251, 247, 0.55)',
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
    color: active ? 'var(--color-cream)' : 'rgba(253, 251, 247, 0.65)',
    background: active ? 'rgba(168, 212, 232, 0.10)' : 'transparent',
    borderLeft: active ? '2px solid var(--color-sky-foxo)' : '2px solid transparent',
    paddingLeft: active ? 10 : 12,
    cursor: 'pointer',
    textDecoration: 'none',
    transition: 'all .15s',
    justifyContent: 'space-between' as const,
  }),
  badge: {
    background: 'var(--color-amber-foxo)',
    color: 'var(--color-cream)',
    borderRadius: 20,
    fontSize: 10,
    fontWeight: 600,
    padding: '1px 7px',
    marginLeft: 'auto',
  },
  // Footer (sticky bottom : juste Déconnexion — ThemeSelector retiré
  // dans la migration mono-thème FoxO)
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
    background: 'linear-gradient(180deg, var(--color-navy-dark) 0%, var(--color-navy-deep) 100%)',
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
    color: active ? 'var(--color-cream)' : 'rgba(253, 251, 247, 0.65)',
    textDecoration: 'none',
    fontSize: 10,
    fontWeight: active ? 600 : 500,
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
  validationCount = 0,
}: {
  alertCount?: number
  recentResponsesCount?: number
  validationCount?: number
}) {
  const pathname = usePathname()
  const router   = useRouter()
  const supabase = createClient()
  // Logo BLANC fixe — la sidebar admin est désormais sur gradient navy
  // permanent (post-migration mono-thème FoxO).

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
      .catch((e) => console.warn('[mails] compteur non-lus indisponible', e))
    return () => { cancelled = true }
  }, [])

  // Re-fetch debounced du compteur quand MailsClient émet un event
  // foxo:mails-updated. Le debounce 800ms coalesce les bursts (5 mails
  // sélectionnés + bulk action = 1 seul fetch). Plus fiable qu'une
  // approche delta : la source de vérité reste Gmail.
  const refetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    function onMailsUpdated() {
      if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current)
      refetchTimerRef.current = setTimeout(() => {
        fetch('/api/admin/mails/unread-count', { cache: 'no-store' })
          .then((r) => r.ok ? r.json() : null)
          .then((data) => { if (data?.ok) setUnreadMails(data.count ?? 0) })
          .catch((e) => console.warn('[mails] compteur non-lus indisponible', e))
      }, 800)
    }
    window.addEventListener('foxo:mails-updated', onMailsUpdated)
    return () => {
      window.removeEventListener('foxo:mails-updated', onMailsUpdated)
      if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current)
    }
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

  // ── Mobile bottom nav — 4 items fixes ──────────────────────────────────
  // Item "Menu" (qui pointait vers /admin/home, retiré Sprint 1) supprimé.
  // L'accès aux pages secondaires (clients, comptabilité, …) se fait via
  // /admin/hub depuis le sélecteur de portail.
  const BOTTOM_NAV: NavItem[] = [
    { href: '/admin',           Icon: BarChart3, label: 'Tableau'   },
    { href: '/admin/alertes',   Icon: Bell,      label: 'Alertes'   },
    { href: '/admin/validation', Icon: ClipboardCheck, label: 'À valider' },
    { href: '/admin/planning',  Icon: Calendar,  label: 'Planning'  },
    { href: '/admin/techniciens', Icon: Wrench,  label: 'Techniciens' },
    { href: '/admin/assistant', Icon: Sparkles,  label: 'Assistant' },
  ]

  return (
    <>
      {/* ── DESKTOP sidebar ─────────────────────────────────────────────────── */}
      <aside style={S.sidebar} className="foxo-sidebar-desktop">
        {/* Logo */}
        <div style={S.logoZone}>
          <Logo size={90} variant="blanc" priority />
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
                <item.Icon size={16} aria-hidden />
                <span>{item.label}</span>
              </span>
              {item.href === '/admin/alertes' && alertCount > 0 && (
                <span style={S.badge}>{alertCount}</span>
              )}
              {item.href === '/admin/validation' && validationCount > 0 && (
                <span style={S.badge}>{validationCount}</span>
              )}
              {item.href === '/admin' && recentResponsesCount > 0 && (
                <span
                  style={{ ...S.badge, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                  title="Réponses occupants reçues (< 48 h)"
                ><Inbox size={11} aria-hidden /> {recentResponsesCount}</span>
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
                <Handshake size={16} aria-hidden />
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
                      <sub.Icon size={16} aria-hidden />
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
                <item.Icon size={16} aria-hidden />
                <span>{item.label}</span>
              </span>
              {item.href === '/admin/mails' && unreadMails > 0 && (
                <span style={S.badge}>{unreadMails}</span>
              )}
            </Link>
          ))}
        </nav>

        {/* Footer : Déconnexion (sélecteur de thème retiré dans la
            migration mono-thème FoxO). */}
        <div style={S.footer}>
          <button
            onClick={handleLogout}
            style={{
              background: 'rgba(255,255,255,.05)',
              border: '1px solid rgba(255,255,255,.08)',
              borderRadius: 7,
              padding: '10px 12px',
              color: 'rgba(253, 251, 247, 0.65)',
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

      {/* ── MOBILE : header fixe en haut avec logo (toggle thème retiré) ─────────── */}
      <header className="foxo-mobile-header">
        <Logo size={36} variant="blanc" />
        <span className="foxo-mobile-header-label">Interface Admin</span>
      </header>

      {/* ── MOBILE bottom nav ────────────────────────────────────────────────── */}
      <nav style={S.bottomNav} className="foxo-sidebar-mobile">
        {BOTTOM_NAV.map(item => {
          const active = isActive(item.href)
          return (
          <Link key={item.href} href={item.href} style={S.bottomNavItem(active)}>
            <span style={S.bottomNavIcon(active)}><item.Icon size={18} aria-hidden /></span>
            <span>{item.label}</span>
            {item.href === '/admin/alertes' && alertCount > 0 && (
              <span style={{
                position: 'absolute',
                top: 6,
                right: '50%',
                transform: 'translateX(8px)',
                background: 'var(--color-amber-foxo)',
                color: 'var(--color-cream)',
                borderRadius: 20,
                fontSize: 9,
                fontWeight: 600,
                padding: '0 5px',
                minWidth: 16,
                textAlign: 'center',
              }}>{alertCount}</span>
            )}
            {item.href === '/admin/validation' && validationCount > 0 && (
              <span style={{
                position: 'absolute',
                top: 6,
                right: '50%',
                transform: 'translateX(8px)',
                background: 'var(--color-amber-foxo)',
                color: 'var(--color-cream)',
                borderRadius: 20,
                fontSize: 9,
                fontWeight: 600,
                padding: '0 5px',
                minWidth: 16,
                textAlign: 'center',
              }}>{validationCount}</span>
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

        @media (max-width: 768px) {
          .foxo-sidebar-desktop { display: none !important; }
          .foxo-sidebar-mobile  { display: flex !important; }
          .foxo-mobile-header {
            display: flex !important;
            position: fixed;
            top: 0; left: 0; right: 0;
            z-index: 80;
            background: linear-gradient(180deg, var(--color-navy-dark) 0%, var(--color-navy-deep) 100%);
            border-bottom: 1px solid rgba(255,255,255,.08);
            padding: max(env(safe-area-inset-top, 8px), 8px) 16px 8px;
            align-items: center;
            justify-content: center;
            gap: 10px;
          }
          .foxo-mobile-header-label {
            font-size: 9px;
            color: rgba(253, 251, 247, 0.55);
            text-transform: uppercase;
            letter-spacing: .15em;
            font-weight: 600;
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
