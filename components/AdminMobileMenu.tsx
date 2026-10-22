// components/AdminMobileMenu.tsx
// FoxO — menu mobile du portail admin (bottom sheet).
//
// Ouvert par le bouton « Menu » de la barre du bas (Sidebar.tsx). Toutes les
// entrées de navigation y sont atteignables, regroupées comme sur la sidebar
// desktop, en tuiles claires. Fermeture : bouton X, voile, touche Échap, et
// automatiquement à chaque navigation (l'état d'ouverture est tenu par la
// Sidebar, indexé sur le pathname). Pendant l'ouverture : dialogue modal,
// défilement du corps bloqué, focus envoyé sur le bouton de fermeture.
// Aucun hex ici : tokens et utilitaires .fx-* (globals.css).

'use client'

import Link from 'next/link'
import { useEffect, useRef } from 'react'
import { LogOut, X } from 'lucide-react'
import type { Compteurs, NavGroupe, NavItem, UtilisateurSidebar } from './Sidebar'

export function AdminMobileMenu({
  open,
  onClose,
  groupes,
  compteurs,
  isActive,
  onLogout,
  utilisateur,
}: {
  open: boolean
  onClose: () => void
  groupes: NavGroupe[]
  compteurs: Compteurs
  isActive: (href: string) => boolean
  onLogout: () => void
  utilisateur: UtilisateurSidebar
}) {
  const closeRef = useRef<HTMLButtonElement>(null)

  // Modal : défilement bloqué, Échap ferme, focus sur la fermeture.
  useEffect(() => {
    if (!open) return
    const precedent = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = precedent
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fx-sheet-root">
      <button type="button" className="fx-sheet-veil" aria-label="Fermer le menu" onClick={onClose} tabIndex={-1} />
      <div role="dialog" aria-modal="true" aria-label="Menu" className="fx-sheet">
        <div className="fx-sheet-head">
          <span className="fx-sheet-handle" aria-hidden />
          <div className="flex items-center justify-between gap-3">
            <h2 className="fx-panel-title">Menu</h2>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label="Fermer le menu"
              className="fx-sheet-close"
            >
              <X size={18} aria-hidden />
            </button>
          </div>
        </div>

        <div className="fx-sheet-body">
          {groupes.map((g) => (
            <section key={g.label} aria-label={g.label} className="flex flex-col gap-2">
              <div className="fx-eyebrow">{g.label}</div>
              <div className="grid grid-cols-2 gap-2">
                {g.items.map((item) => (
                  <Tuile key={item.href} item={item} active={isActive(item.href)} compteur={compteurDe(item, compteurs)} onClose={onClose} />
                ))}
              </div>
            </section>
          ))}
        </div>

        <div className="fx-sheet-foot">
          <span className="fx-avatar fx-avatar-navy fx-avatar-lg" aria-hidden>{utilisateur.initiales}</span>
          <div className="min-w-0 flex-1">
            <div className="fx-name text-ink truncate">{utilisateur.affichage}</div>
            <div className="fx-small">{utilisateur.role}</div>
          </div>
          <button type="button" onClick={onLogout} className="fx-btn-danger">
            <LogOut size={15} aria-hidden /> Déconnexion
          </button>
        </div>
      </div>
    </div>
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

function Tuile({ item, active, compteur, onClose }: { item: NavItem; active: boolean; compteur: number; onClose: () => void }) {
  return (
    <Link
      href={item.href}
      onClick={onClose}
      aria-current={active ? 'page' : undefined}
      className={`fx-tile${active ? ' is-active' : ''}`}
    >
      <span className={`fx-ico fx-ico-md fx-ico-light-${item.teinte}${active ? ' is-full' : ''}`}>
        <item.Icon size={16} strokeWidth={2} aria-hidden />
      </span>
      <span className="fx-tile-label flex-1 min-w-0 truncate">{item.label}</span>
      {compteur > 0 && (
        <span className={`fx-badge ${item.badge === 'alertes' ? 'fx-badge-terra-solid' : 'fx-badge-amber-solid'}`}>
          {compteur}
        </span>
      )}
    </Link>
  )
}
