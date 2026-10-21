// components/Sidebar.tsx
// FoxO — navigation du portail admin (maquette « marine iconique », 22/10/2026).
//
// Desktop (> 768 px) : sidebar gauche 264 px, entrées regroupées (Pilotage,
// Terrain, Relations, Gestion), icônes dans des pastilles colorées, carte
// utilisateur + déconnexion en pied.
// Mobile (≤ 768 px) : en-tête fixe (logo + bouton Déconnexion), barre du bas
// à 5 items dont « Menu », qui ouvre le bottom sheet AdminMobileMenu avec
// la liste complète des sections.
//
// Le breakpoint (768 px), les href, les sources des compteurs (alertes et
// validation passés par le layout, mails lus côté client) et le mécanisme de
// déconnexion sont inchangés. Aucun hex ici : tout vient de globals.css.

'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Logo } from '@/components/Logo'
import {
  Activity, Bell, BriefcaseBusiness, Building2, CalendarDays, CircleCheck,
  ClipboardList, FileUp, Handshake, Inbox, Landmark, LayoutDashboard, LogOut,
  Mail, Menu, Settings, ShieldCheck, Sparkles, User, Users, Wrench,
  type LucideIcon,
} from 'lucide-react'
import { AdminMobileMenu } from './AdminMobileMenu'

export type TeinteNav = 'sky' | 'amber' | 'terra' | 'ok' | 'neutral'
export type BadgeNav = 'alertes' | 'validation' | 'mails' | 'reponses'

export interface NavItem {
  href: string
  Icon: LucideIcon
  label: string
  teinte: TeinteNav
  badge?: BadgeNav
  /** Libellé court de la barre du bas. */
  court?: string
}
export interface NavGroupe { label: string; items: NavItem[] }
export interface Compteurs { alertes: number; validation: number; mails: number; reponses: number }
export interface UtilisateurSidebar { affichage: string; initiales: string; role: string }

// Toutes les entrées historiques, href inchangés, réparties en 4 groupes.
// « Import » (absent de la maquette) rejoint Gestion.
export const NAV_GROUPES: NavGroupe[] = [
  {
    label: 'Pilotage',
    items: [
      { href: '/admin',           Icon: LayoutDashboard, label: 'Tableau de bord', teinte: 'sky',   badge: 'reponses', court: 'Tableau' },
      { href: '/admin/alertes',   Icon: Bell,            label: 'Alertes',         teinte: 'terra', badge: 'alertes' },
      { href: '/admin/assistant', Icon: Sparkles,        label: 'Assistant IA',    teinte: 'amber' },
    ],
  },
  {
    label: 'Terrain',
    items: [
      { href: '/admin/interventions', Icon: ClipboardList, label: 'Interventions', teinte: 'amber', court: 'Interventions' },
      { href: '/admin/planning',      Icon: CalendarDays,  label: 'Planning',      teinte: 'sky',   court: 'Planning' },
      { href: '/admin/validation',    Icon: CircleCheck,   label: 'À valider',     teinte: 'terra', badge: 'validation', court: 'À valider' },
      { href: '/admin/techniciens',   Icon: Wrench,        label: 'Techniciens',   teinte: 'ok' },
    ],
  },
  {
    label: 'Relations',
    items: [
      { href: '/admin/mails',     Icon: Mail,        label: 'Mails',     teinte: 'amber', badge: 'mails' },
      { href: '/admin/clients',   Icon: Building2,   label: 'Clients',   teinte: 'ok' },
      { href: '/admin/syndics',   Icon: Users,       label: 'Syndics',   teinte: 'sky' },
      { href: '/admin/courtiers', Icon: Handshake,   label: 'Courtiers', teinte: 'sky' },
      { href: '/admin/experts',   Icon: ShieldCheck, label: 'Experts',   teinte: 'sky' },
    ],
  },
  {
    label: 'Gestion',
    items: [
      { href: '/admin/comptabilite',  Icon: Landmark,          label: 'Comptabilité',     teinte: 'ok' },
      { href: '/admin/import',        Icon: FileUp,            label: 'Import',           teinte: 'neutral' },
      { href: '/admin/metiers',       Icon: BriefcaseBusiness, label: 'Métiers',          teinte: 'ok' },
      { href: '/admin/utilisateurs',  Icon: User,              label: 'Utilisateurs',     teinte: 'sky' },
      { href: '/admin/observabilite', Icon: Activity,          label: 'Observabilité IA', teinte: 'terra' },
      { href: '/admin/parametres',    Icon: Settings,          label: 'Paramètres',       teinte: 'neutral' },
    ],
  },
]

const TOUS_LES_ITEMS = NAV_GROUPES.flatMap((g) => g.items)
const trouver = (href: string): NavItem => TOUS_LES_ITEMS.find((i) => i.href === href)!

// Barre du bas : Tableau · Interventions · À valider · Planning · Menu.
const BOTTOM_NAV: NavItem[] = [
  trouver('/admin'),
  trouver('/admin/interventions'),
  trouver('/admin/validation'),
  trouver('/admin/planning'),
]

export function estActif(pathname: string, href: string): boolean {
  // /admin : correspondance exacte ; /admin/comptabilite redirige vers
  // /admin/facturation : l'entrée Comptabilité est active sur les deux.
  if (href === '/admin') return pathname === '/admin'
  if (href === '/admin/comptabilite') {
    return pathname.startsWith('/admin/comptabilite') || pathname.startsWith('/admin/facturation')
  }
  return pathname.startsWith(href)
}

function initialesDe(nom: string | null, email: string | null): string {
  const base = (nom ?? '').trim() || (email ?? '').split('@')[0].replace(/[._-]+/g, ' ')
  const mots = base.split(/\s+/).filter(Boolean)
  const ini = (mots[0]?.[0] ?? '') + (mots[1]?.[0] ?? mots[0]?.[1] ?? '')
  return ini.toUpperCase() || 'AD'
}

function affichageDe(nom: string | null, email: string | null): string {
  if (nom && nom.trim()) return nom.trim()
  const e = (email ?? '').trim()
  if (!e) return 'Administrateur'
  const [local, domaine] = e.split('@')
  const court = local.length > 16 ? `${local.slice(0, 15)}…` : local
  return domaine ? `${court}@${domaine}` : court
}

// ─── Composant ─────────────────────────────────────────────────────────────────
export default function Sidebar({
  alertCount = 0,
  recentResponsesCount = 0,
  validationCount = 0,
  utilisateur,
}: {
  alertCount?: number
  recentResponsesCount?: number
  validationCount?: number
  utilisateur?: { email: string | null; nom: string | null }
}) {
  const pathname = usePathname()
  const router   = useRouter()
  const supabase = createClient()

  // Badge mails non lus (Gmail) — fetch lazy une fois monté côté client.
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

  // Re-fetch debounced du compteur quand MailsClient émet foxo:mails-updated.
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

  const isActive = useCallback((href: string) => estActif(pathname, href), [pathname])

  // Menu mobile : ouvert « pour » un pathname — un changement de page le
  // referme de lui-même, sans effet.
  const [menuOuvertPour, setMenuOuvertPour] = useState<string | null>(null)
  const menuOpen = menuOuvertPour === pathname
  const menuBtnRef = useRef<HTMLButtonElement>(null)
  const fermerMenu = useCallback(() => {
    setMenuOuvertPour(null)
    // Le focus revient sur le bouton qui a ouvert le menu.
    requestAnimationFrame(() => menuBtnRef.current?.focus())
  }, [])

  const compteurs: Compteurs = {
    alertes: alertCount,
    validation: validationCount,
    mails: unreadMails,
    reponses: recentResponsesCount,
  }
  const user: UtilisateurSidebar = {
    affichage: affichageDe(utilisateur?.nom ?? null, utilisateur?.email ?? null),
    initiales: initialesDe(utilisateur?.nom ?? null, utilisateur?.email ?? null),
    role: 'Administrateur',
  }

  const hrefDe = (item: NavItem) =>
    item.href === '/admin' && recentResponsesCount > 0 ? '/admin?recent_responses=1' : item.href

  function badgeDesktop(item: NavItem) {
    const n = compteurDe(item, compteurs)
    if (n <= 0) return null
    if (item.badge === 'reponses') {
      return (
        <span className="fx-badge" title="Réponses occupants reçues (< 48 h)">
          <Inbox size={11} aria-hidden /> {n}
        </span>
      )
    }
    return <span className={`fx-badge${item.badge === 'alertes' ? ' fx-badge-terra' : ''}`}>{n}</span>
  }

  return (
    <>
      {/* ── DESKTOP ───────────────────────────────────────────────────────── */}
      <aside className="foxo-sidebar-desktop fx-sidebar-bg" aria-label="Navigation principale">
        <Link href="/admin" className="fx-sb-logo" aria-label="FoxO — tableau de bord">
          <span className="fx-sb-logo-mark"><Logo size={38} variant="blanc" priority /></span>
          <span className="flex flex-col gap-0.5 min-w-0">
            <span className="fx-wordmark text-cream">FoxO</span>
            <span className="fx-eyebrow fx-eyebrow-dim">Interface admin</span>
          </span>
        </Link>

        <nav className="flex flex-col gap-4 flex-1" aria-label="Sections">
          {NAV_GROUPES.map((g) => (
            <div key={g.label} className="flex flex-col gap-0.5">
              <div className="fx-eyebrow fx-eyebrow-faint px-2.5 pb-1.5">{g.label}</div>
              {g.items.map((item) => {
                const active = isActive(item.href)
                return (
                  <Link
                    key={item.href}
                    href={hrefDe(item)}
                    aria-current={active ? 'page' : undefined}
                    className={`fx-nav-item${active ? ' is-active' : ''}`}
                  >
                    <span className={`fx-ico fx-ico-${item.teinte}${active ? ' is-full' : ''}`}>
                      <item.Icon size={16} strokeWidth={active ? 2.2 : 2} aria-hidden />
                    </span>
                    <span className="fx-nav flex-1 min-w-0 truncate">{item.label}</span>
                    {badgeDesktop(item)}
                  </Link>
                )
              })}
            </div>
          ))}
        </nav>

        <div className="fx-user-card">
          <span className="fx-avatar fx-avatar-sky" aria-hidden>{user.initiales}</span>
          <div className="min-w-0 flex-1">
            <div className="fx-tile-label text-cream truncate">{user.affichage}</div>
            <div className="fx-role">{user.role}</div>
          </div>
          <button type="button" onClick={handleLogout} aria-label="Déconnexion" title="Déconnexion" className="fx-sb-iconbtn">
            <LogOut size={16} aria-hidden />
          </button>
        </div>
      </aside>

      {/* ── MOBILE : en-tête fixe ─────────────────────────────────────────── */}
      <header className="foxo-mobile-header fx-sidebar-bg">
        <Link href="/admin" className="flex items-center gap-2.5 min-w-0" aria-label="FoxO — tableau de bord">
          <span className="fx-sb-logo-mark fx-sb-logo-mark-sm"><Logo size={32} variant="blanc" /></span>
          <span className="flex flex-col gap-0.5 min-w-0">
            <span className="fx-wordmark fx-wordmark-sm text-cream">FoxO</span>
            <span className="fx-eyebrow fx-eyebrow-dim">Interface admin</span>
          </span>
        </Link>
        <button type="button" onClick={handleLogout} className="fx-sb-logout">
          <LogOut size={15} aria-hidden /> Déconnexion
        </button>
      </header>

      {/* ── MOBILE : barre du bas ─────────────────────────────────────────── */}
      <nav className="foxo-sidebar-mobile fx-sidebar-bg" aria-label="Navigation principale">
        {BOTTOM_NAV.map((item) => {
          const active = isActive(item.href)
          const n = item.badge === 'validation' ? validationCount : 0
          return (
            <Link
              key={item.href}
              href={hrefDe(item)}
              aria-current={active ? 'page' : undefined}
              className={`fx-tab${active ? ' is-active' : ''}`}
            >
              <span className={`fx-ico fx-ico-tab fx-ico-${item.teinte}${active ? ' is-full' : ''}`}>
                <item.Icon size={17} strokeWidth={active ? 2.2 : 2} aria-hidden />
              </span>
              <span className="fx-nav-mobile">{item.court ?? item.label}</span>
              {n > 0 && <span className="fx-badge fx-tab-badge" data-fx-overlay>{n}</span>}
            </Link>
          )
        })}
        <button
          ref={menuBtnRef}
          type="button"
          onClick={() => setMenuOuvertPour(pathname)}
          aria-haspopup="dialog"
          aria-expanded={menuOpen}
          className={`fx-tab${menuOpen ? ' is-active' : ''}`}
        >
          <span className={`fx-ico fx-ico-tab fx-ico-neutral${menuOpen ? ' is-full' : ''}`}>
            <Menu size={17} strokeWidth={2} aria-hidden />
          </span>
          <span className="fx-nav-mobile">Menu</span>
        </button>
      </nav>

      <AdminMobileMenu
        open={menuOpen}
        onClose={fermerMenu}
        groupes={NAV_GROUPES}
        compteurs={compteurs}
        isActive={isActive}
        onLogout={handleLogout}
        utilisateur={user}
      />
    </>
  )
}

function compteurDe(item: NavItem, c: Compteurs): number {
  switch (item.badge) {
    case 'alertes': return c.alertes
    case 'validation': return c.validation
    case 'mails': return c.mails
    case 'reponses': return c.reponses
    default: return 0
  }
}
