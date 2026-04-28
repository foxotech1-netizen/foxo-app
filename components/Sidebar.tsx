// components/Sidebar.tsx
// FoxO — Sidebar Admin
// Desktop : sidebar gauche 220px
// Mobile : bottom navigation bar

'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { ThemeToggle } from '@/components/ThemeToggle'
import type { Utilisateur } from '@/lib/types/database'

interface TechSummary {
  ok: boolean
  tech: { prenom: string | null; nom: string | null; email: string | null } | null
  today: { id: string; ref: string | null; type: string | null; creneau_debut: string | null; statut: string; acp_nom: string | null }[]
  month_realisees: number
  month_rapports: number
  next_slots: { id: string; date: string; heure_debut: string; heure_fin: string }[]
  error?: string
}

const NAV_MAIN = [
  { href: '/admin',           icon: '▦', label: 'Tableau de bord' },
  { href: '/admin/alertes',   icon: '◉', label: 'Alertes', badge: true },
  { href: '/admin/planning',  icon: '▷', label: 'Planning'    },
  { href: '/admin/assistant', icon: '✨', label: 'Assistant'   },
]

const NAV_GESTION = [
  { href: '/admin/syndics',    icon: '👥', label: 'Syndics'    },
  { href: '/admin/mails',      icon: '✉',  label: 'Mails'      },
  { href: '/admin/parametres', icon: '⊙',  label: 'Paramètres' },
]

function initiales(prenom: string | null, nom: string | null): string {
  const p = (prenom ?? '').trim()
  const n = (nom ?? '').trim()
  return ((p[0] ?? '') + (n[0] ?? '')).toUpperCase() || '??'
}

function shortName(prenom: string | null, nom: string | null): string {
  const p = (prenom ?? '').trim()
  const n = (nom ?? '').trim()
  if (p && n) return `${p[0]}. ${n}`
  return n || p || '—'
}

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
export default function Sidebar({
  alertCount = 0,
  techs = [],
}: {
  alertCount?: number
  techs?: Utilisateur[]
}) {
  const pathname     = usePathname()
  const router       = useRouter()
  const searchParams = useSearchParams()
  const supabase     = createClient()

  const activeTech = searchParams.get('tech')

  function handleTechClick(id: string) {
    if (activeTech === id) {
      router.push('/admin')
    } else {
      router.push(`/admin?tech=${id}`)
    }
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  const isActive = (href: string) =>
    href === '/admin' ? pathname === '/admin' : pathname.startsWith(href)

  // ── Mobile bottom nav ───────────────────────────────────────────────────────
  const BOTTOM_NAV = [
    { href: '/admin',           icon: '▦', label: 'Tableau'   },
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
          {techs.length === 0 && (
            <div style={{ ...S.techSub, padding: '4px 0' }}>Aucun technicien encodé.</div>
          )}
          {techs.map(t => (
            <TechSidebarRow
              key={t.id}
              tech={t}
              active={activeTech === t.id}
              onFilter={() => handleTechClick(t.id)}
            />
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

// ─── Ligne technicien avec mini-fiche ─────────────────────────────────────
function TechSidebarRow({
  tech,
  active,
  onFilter,
}: {
  tech: Utilisateur
  active: boolean
  onFilter: () => void
}) {
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [summary, setSummary] = useState<TechSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  // Fermer le popover sur clic extérieur ou Escape
  useEffect(() => {
    if (!popoverOpen) return
    function onDocMouseDown(e: MouseEvent) {
      if (
        popoverRef.current && !popoverRef.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) {
        setPopoverOpen(false)
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setPopoverOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [popoverOpen])

  async function togglePopover() {
    if (popoverOpen) {
      setPopoverOpen(false)
      return
    }
    setPopoverOpen(true)
    if (summary) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/tech-summary/${tech.id}`)
      const data = (await res.json()) as TechSummary
      if (!data.ok) {
        setError(data.error ?? 'Erreur de chargement.')
      } else {
        setSummary(data)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur réseau.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ position: 'relative' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: active ? 'rgba(161, 114, 68, .18)' : 'transparent',
          border: active ? '1px solid #A17244' : '1px solid transparent',
          borderRadius: 8,
          padding: '6px 8px',
          margin: '2px -2px',
          transition: 'all .15s',
        }}
      >
        <button
          type="button"
          onClick={onFilter}
          title={active ? 'Cliquer pour désactiver le filtre' : 'Filtrer le pipeline sur ce technicien'}
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            gap: 9,
            background: 'transparent',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            fontFamily: 'inherit',
            textAlign: 'left',
            color: 'inherit',
            minWidth: 0,
          }}
        >
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: '50%',
              background: active ? '#A17244' : '#3D3A32',
              color: active ? '#FFFFFF' : '#C0BAB0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 10,
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            {initiales(tech.prenom, tech.nom)}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: active ? '#F0ECE4' : '#C0BAB0' }}>
              {shortName(tech.prenom, tech.nom)}
            </div>
            <div style={{ fontSize: 10, color: '#5A5650', marginTop: 1 }}>
              {active ? '● Pipeline filtré' : 'En ligne'}
            </div>
          </div>
        </button>
        <button
          ref={buttonRef}
          type="button"
          onClick={togglePopover}
          title="Voir la fiche technicien"
          aria-label="Mini-fiche"
          style={{
            background: popoverOpen ? 'rgba(255,255,255,.1)' : 'transparent',
            border: 'none',
            color: '#8A8278',
            fontSize: 14,
            lineHeight: 1,
            cursor: 'pointer',
            padding: '4px 6px',
            borderRadius: 6,
            fontFamily: 'inherit',
          }}
        >
          ⋯
        </button>
      </div>

      {popoverOpen && (
        <div
          ref={popoverRef}
          style={{
            position: 'absolute',
            top: 0,
            left: 'calc(100% + 8px)',
            background: '#FAF6EE',
            color: '#1C1A16',
            border: '1px solid #DDD3C3',
            borderRadius: 12,
            padding: 12,
            width: 280,
            boxShadow: '0 16px 40px rgba(0,0,0,.35)',
            zIndex: 200,
          }}
          className="foxo-tech-popover"
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: '50%',
              background: '#A17244', color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 700,
            }}>
              {initiales(tech.prenom, tech.nom)}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 800 }}>
                {shortName(tech.prenom, tech.nom)}
              </div>
              <div style={{ fontSize: 10, color: '#1F6B45', display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 6, height: 6, borderRadius: 3, background: '#1F6B45' }} />
                En ligne
              </div>
            </div>
          </div>

          {loading && (
            <div style={{ fontSize: 12, color: '#6B6558', textAlign: 'center', padding: 12 }}>
              Chargement…
            </div>
          )}

          {error && (
            <div style={{ fontSize: 11, color: '#C4622D', background: '#F7EDE5', padding: 8, borderRadius: 6 }}>
              {error}
            </div>
          )}

          {summary && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 10 }}>
                <div style={{ background: '#FFFFFF', border: '1px solid #DDD3C3', borderRadius: 8, padding: '6px 8px' }}>
                  <div style={{ fontSize: 16, fontWeight: 800, lineHeight: 1 }}>{summary.month_realisees}</div>
                  <div style={{ fontSize: 9, color: '#6B6558', marginTop: 2, textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 700 }}>
                    Réalisées (mois)
                  </div>
                </div>
                <div style={{ background: '#D4EDE2', border: '1px solid #A8D4BC', borderRadius: 8, padding: '6px 8px' }}>
                  <div style={{ fontSize: 16, fontWeight: 800, lineHeight: 1, color: '#1F6B45' }}>{summary.month_rapports}</div>
                  <div style={{ fontSize: 9, color: '#1F6B45', marginTop: 2, textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 700 }}>
                    Rapports publiés
                  </div>
                </div>
              </div>

              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: '#6B6558', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 4 }}>
                  Aujourd&apos;hui
                </div>
                {summary.today.length === 0 ? (
                  <div style={{ fontSize: 11, color: '#9C9588', fontStyle: 'italic' }}>Aucune intervention.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {summary.today.map(iv => (
                      <div key={iv.id} style={{ background: '#fff', border: '1px solid #DDD3C3', borderRadius: 6, padding: '5px 7px', fontSize: 11 }}>
                        <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#1B3A6B' }}>
                          {iv.creneau_debut ? new Date(iv.creneau_debut).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' }) : '—'}
                        </span>
                        {' · '}
                        <span style={{ fontWeight: 600 }}>{iv.acp_nom ?? iv.ref ?? '?'}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <div style={{ fontSize: 9, fontWeight: 700, color: '#6B6558', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 4 }}>
                  Prochains créneaux libres
                </div>
                {summary.next_slots.length === 0 ? (
                  <div style={{ fontSize: 11, color: '#9C9588', fontStyle: 'italic' }}>Aucun créneau libre.</div>
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {summary.next_slots.map(s => (
                      <span key={s.id} style={{
                        background: '#D4EDE2', color: '#1F6B45', border: '1px solid #A8D4BC',
                        borderRadius: 6, padding: '3px 6px', fontSize: 10, fontWeight: 700,
                      }}>
                        {new Date(s.date + 'T12:00:00').toLocaleDateString('fr-BE', { day: 'numeric', month: 'short' })}
                        {' · '}{s.heure_debut}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      <style>{`
        @media (max-width: 768px) {
          .foxo-tech-popover {
            position: fixed !important;
            top: auto !important;
            bottom: calc(80px + env(safe-area-inset-bottom, 0px)) !important;
            left: 12px !important;
            right: 12px !important;
            width: auto !important;
            max-height: 60vh;
            overflow-y: auto;
          }
        }
      `}</style>
    </div>
  )
}
