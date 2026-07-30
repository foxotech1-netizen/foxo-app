'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Camera,
  ChevronLeft,
  ClipboardList,
  CreditCard,
  FileText,
  FolderOpen,
  MessageSquare,
  Navigation,
  Phone,
  StickyNote,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { StatutBadge } from '@/components/StatutBadge';
import type { StatutIntervention } from '@/lib/types/database';

// Coquille de la fiche intervention (thème sombre) : remplace le long
// défilement de 7 panneaux par un écran "hub" (en-tête compact, actions
// rapides, chrono, 6 tuiles) dont chaque section s'ouvre en plein écran.
//
// ⚠ Les panneaux restent MONTÉS en permanence : la vue non active est
// masquée en CSS (hidden), jamais démontée — un upload de photo, un texte
// de rapport en cours de saisie ou le chrono ne doivent pas perdre leur
// état quand le technicien navigue entre hub et sections.
//
// La coquille ne fait AUCUN fetch : tout arrive par props depuis
// page.tsx (server component), les panneaux par slots ReactNode.

export type SectionKey =
  | 'photos' | 'documents' | 'observations' | 'rapport' | 'notes' | 'paiement';

interface HeaderInfo {
  ref: string | null;
  type: string | null;
  statut: StatutIntervention;
  urgent: boolean;
  acpNom: string | null;
  /** Adresse ACP complète (rue, CP, ville). */
  adresse: string | null;
  /** Complément (appartement/étage) saisi sur l'intervention. */
  adresseComplement: string | null;
  creneau: { time: string; dateLabel: string } | null;
  occupant: {
    nom: string | null;
    appartement: string | null;
    telephone: string | null;
  } | null;
}

interface QuickActions {
  /** href tel: — null si aucun numéro d'occupant connu (bouton masqué). */
  tel: string | null;
  /** href Google Maps — null si aucune adresse (bouton masqué). */
  maps: string | null;
  /** href sms: pré-rempli retard — null si aucun numéro (bouton masqué). */
  sms: string | null;
}

interface InterventionShellProps {
  header: HeaderInfo;
  actions: QuickActions;
  /** Compteur déjà connu de page.tsx — aucune requête supplémentaire. */
  photoCount: number;
  timer: React.ReactNode;
  sections: Record<SectionKey, React.ReactNode>;
  /** Problème déclaré + contacts (syndic, occupants) — repliés sous le hub. */
  details?: React.ReactNode;
}

// Icônes résolues ICI, côté client : page.tsx (server) ne passe jamais de
// composant lucide en prop (régression RSC PR #48) — uniquement des slots
// ReactNode déjà rendus et des données sérialisables.
const SECTIONS: {
  key: SectionKey;
  title: string;
  subtitle: string;
  icon: LucideIcon;
  variant: 'violet' | 'green' | 'amber' | 'orange' | 'sky';
}[] = [
  { key: 'photos',       title: 'Photos',        subtitle: 'Prises sur place',    icon: Camera,        variant: 'violet' },
  { key: 'observations', title: 'Constatations', subtitle: 'Tests & mesures',     icon: ClipboardList, variant: 'amber'  },
  { key: 'rapport',      title: 'Rapport',       subtitle: 'Rédaction & envoi',   icon: FileText,      variant: 'green'  },
  { key: 'documents',    title: 'Documents',     subtitle: 'Dossier Drive',       icon: FolderOpen,    variant: 'sky'    },
  { key: 'notes',        title: 'Notes perso',   subtitle: 'Privées, hors rapport', icon: StickyNote,  variant: 'orange' },
  { key: 'paiement',     title: 'Paiement',      subtitle: 'QR sur place',        icon: CreditCard,    variant: 'green'  },
];

export function InterventionShell({
  header,
  actions,
  photoCount,
  timer,
  sections,
  details,
}: InterventionShellProps) {
  const [open, setOpen] = useState<'hub' | SectionKey>('hub');

  // Chaque bascule repart du haut de l'écran : on arrive toujours sur la
  // barre de titre de la vue, pas au milieu d'un panneau.
  function go(view: 'hub' | SectionKey) {
    setOpen(view);
    window.scrollTo({ top: 0 });
  }

  return (
    <div>
      {/* ── Vue hub ─────────────────────────────────────────────────── */}
      <div className={open === 'hub' ? 'space-y-4' : 'hidden'}>
        <header>
          <div className="flex items-center justify-between gap-2">
            <Link
              href="/tech/missions"
              className="inline-flex items-center gap-0.5 min-h-[44px] text-[13px] font-semibold"
              style={{ color: 'var(--tech-text-2)' }}
            >
              <ChevronLeft size={16} aria-hidden />
              Missions
            </Link>
            <StatutBadge statut={header.statut} />
          </div>
          <h1
            className="font-sora font-semibold text-[20px] tracking-[-0.01em]"
            style={{ color: 'var(--tech-text-1)' }}
          >
            <span style={{ color: 'var(--tech-cta-2)' }}>{header.ref ?? '—'}</span>
            {header.type && (
              <span className="font-normal" style={{ color: 'var(--tech-text-2)' }}>
                {' '}· {header.type}
              </span>
            )}
          </h1>
          {header.urgent && (
            <span className="mt-1.5 text-[11px] font-semibold text-[var(--color-terra)] bg-[var(--color-terra-light)] border border-[var(--color-terra-mid)] rounded-full px-2.5 py-1 inline-flex items-center gap-1">
              <Zap size={11} aria-hidden />URGENT
            </span>
          )}
          {header.acpNom && (
            <p className="text-[14px] font-semibold mt-1.5" style={{ color: 'var(--tech-text-1)' }}>
              {header.acpNom}
            </p>
          )}
          <p className="text-[13px] mt-0.5 leading-relaxed" style={{ color: 'var(--tech-text-2)' }}>
            {header.adresse ?? '—'}
            {header.adresseComplement && (
              <>
                {' '}·{' '}
                <span className="font-semibold" style={{ color: 'var(--tech-text-1)' }}>
                  {header.adresseComplement}
                </span>
              </>
            )}
          </p>
          {header.occupant && (
            <p className="text-[13px] mt-0.5" style={{ color: 'var(--tech-text-2)' }}>
              {header.occupant.nom ?? 'Occupant'}
              {header.occupant.appartement && <> · Apt. {header.occupant.appartement}</>}
              {header.occupant.telephone && (
                <> · <span className="font-mono">{header.occupant.telephone}</span></>
              )}
            </p>
          )}
          {header.creneau && (
            <p className="text-[12px] mt-2 font-mono flex items-center gap-2" style={{ color: 'var(--tech-text-2)' }}>
              <span className="font-semibold" style={{ color: 'var(--accent-tech)' }}>
                {header.creneau.time}
              </span>
              <span>·</span>
              <span className="capitalize">{header.creneau.dateLabel}</span>
            </p>
          )}
        </header>

        {/* Actions rapides — liens natifs uniquement (tel:, sms:, maps),
            boutons masqués si la donnée manque. */}
        <div className="flex gap-2">
          {actions.tel && (
            <a href={actions.tel} className="tech-quick flex-1">
              <Phone size={20} aria-hidden />
              Appeler
            </a>
          )}
          {actions.maps && (
            <a
              href={actions.maps}
              target="_blank"
              rel="noopener noreferrer"
              className="tech-quick flex-1"
            >
              <Navigation size={20} aria-hidden />
              Itinéraire
            </a>
          )}
          {actions.sms && (
            <a href={actions.sms} className="tech-quick flex-1">
              <MessageSquare size={20} aria-hidden />
              Retard
            </a>
          )}
        </div>

        {timer}

        <nav aria-label="Sections de l'intervention" className="space-y-[11px]">
          {SECTIONS.map((s) => {
            const badge = s.key === 'photos' ? photoCount : 0;
            const Icon = s.icon;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => go(s.key)}
                className="tech-tile w-full text-left"
                aria-label={
                  badge > 0
                    ? `${s.title} — ${badge} élément${badge > 1 ? 's' : ''}`
                    : undefined
                }
              >
                <span className={`tech-chip tech-chip-${s.variant}`}>
                  <Icon size={23} strokeWidth={2.2} aria-hidden />
                </span>
                <span className="flex-1 min-w-0">
                  <span
                    className="block font-sora font-bold text-[15.5px] leading-tight tracking-[-0.01em]"
                    style={{ color: 'var(--tech-text-1)' }}
                  >
                    {s.title}
                  </span>
                  <span className="block text-[12px] mt-0.5 truncate" style={{ color: 'var(--tech-text-2)' }}>
                    {s.subtitle}
                  </span>
                </span>
                {badge > 0 && (
                  <span className="tech-badge" aria-hidden>
                    {badge > 99 ? '99+' : badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {details && (
          <details className="tech-glass-card">
            <summary
              className="p-4 cursor-pointer select-none font-sora text-[13px] font-semibold"
              style={{ color: 'var(--tech-text-2)' }}
            >
              Infos dossier — problème & contacts
            </summary>
            <div className="px-4 pb-4 space-y-4">{details}</div>
          </details>
        )}
      </div>

      {/* ── Vues section — toutes montées, seule l'active est visible ── */}
      {SECTIONS.map((s) => (
        <div key={s.key} className={open === s.key ? '' : 'hidden'}>
          <div className="flex items-center gap-1 mb-3">
            <button
              type="button"
              onClick={() => go('hub')}
              className="inline-flex items-center gap-0.5 min-h-[44px] pr-2 text-[13px] font-semibold"
              style={{ color: 'var(--tech-text-2)' }}
            >
              <ChevronLeft size={16} aria-hidden />
              Retour
            </button>
            <h2
              className="font-sora font-semibold text-[20px] tracking-[-0.01em]"
              style={{ color: 'var(--tech-text-1)' }}
            >
              {s.title}
            </h2>
          </div>
          {/* Feuille claire : les panneaux gardent leur style fond clair. */}
          <div className="tech-sheet">{sections[s.key]}</div>
        </div>
      ))}
    </div>
  );
}
