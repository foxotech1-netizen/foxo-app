'use client';

// Badges enrichis affichés sous l'expéditeur d'un mail analysé :
//   - TYPE (couleur sémantique selon le verdict Claude)
//   - LANGUE (FR/NL/EN/OTHER, discret)
//   - URGENT (terra avec animation pulse) si urgence=true
//   - Lien "Dossier {ref}" → /admin/interventions/{id} si dossier_match_id

import Link from 'next/link';
import { Zap } from 'lucide-react';
import type { MailAnalyse, MailAnalyseType } from './MailAnalyseTypes';

const TYPE_LABEL: Record<MailAnalyseType, string> = {
  demande_intervention: 'Demande intervention',
  relance_rapport:      'Relance rapport',
  suivi_dossier:        'Suivi dossier',
  question_generale:    'Question',
  accuse_reception:     'Accusé réception',
  spam_commercial:      'Spam commercial',
};

const TYPE_PALETTE: Record<MailAnalyseType, { bg: string; fg: string }> = {
  demande_intervention: { bg: 'var(--color-amber-light)',     fg: 'var(--color-amber-foxo)' },
  relance_rapport:      { bg: 'var(--color-terra-light)',     fg: 'var(--color-terra)' },
  suivi_dossier:        { bg: 'var(--color-sky-light-foxo)',  fg: 'var(--color-navy)' },
  question_generale:    { bg: 'var(--color-sand-mid)',        fg: 'var(--color-ink)' },
  accuse_reception:     { bg: 'var(--color-ok-light)',        fg: 'var(--color-ok)' },
  spam_commercial:      { bg: 'var(--color-sand-border)',     fg: 'var(--color-ink-mid)' },
};

interface Props {
  analyse: MailAnalyse;
  className?: string;
}

export function MailAnalyseBadges({ analyse, className = '' }: Props) {
  const type = analyse.type;
  const typePalette = type ? TYPE_PALETTE[type] : null;
  const typeLabel = type ? TYPE_LABEL[type] : null;
  const langue = analyse.langue && analyse.langue !== 'other' ? analyse.langue.toUpperCase() : null;

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`.trim()}>
      {type && typePalette && typeLabel && (
        <span
          className="font-sora inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold tracking-[0.01em]"
          style={{ background: typePalette.bg, color: typePalette.fg }}
        >
          {typeLabel}
        </span>
      )}

      {langue && (
        <span
          className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium tracking-wider"
          style={{ background: 'var(--color-sand)', color: 'var(--color-ink-mid)', border: '1px solid var(--color-sand-border)' }}
        >
          {langue}
        </span>
      )}

      {analyse.urgence && (
        <span
          className="mail-badge-urgent inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider"
          style={{ background: 'var(--color-terra)', color: 'var(--color-cream)' }}
        >
          <Zap size={10} aria-hidden />
          Urgent
        </span>
      )}

      {analyse.dossier && (
        <Link
          href={`/admin/interventions/${analyse.dossier.id}`}
          className="font-sora inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold hover:underline"
          style={{
            background: 'var(--color-navy-pale)',
            color: 'var(--color-navy)',
            border: '1px solid var(--color-navy-light)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          Dossier {analyse.dossier.ref ?? '?'}
        </Link>
      )}

      <style>{`
        .mail-badge-urgent {
          animation: mailBadgePulse 1.6s ease-in-out infinite;
        }
        @keyframes mailBadgePulse {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0.55; }
        }
      `}</style>
    </div>
  );
}
