'use client';

// BriefingIA — card du Tableau de bord admin présentant le briefing
// quotidien généré par Claude FoxO.
//
// ⚠ Sprint 1 : contenu STATIQUE (placeholder hardcodé). Au Sprint 2,
// le body sera remplacé par le résultat d'un appel server action
// `getBriefing(userId)` (Anthropic SDK). Conserver l'API du composant
// (props + classes) pour minimiser le diff lors du branchement.

import { useSyncExternalStore } from 'react';
import { Mail, AlertTriangle, Calendar, type LucideIcon } from 'lucide-react';

export interface BriefingCounts {
  interventionsToday: number;
  urgences: number;
  mailsNonLus: number;
}

interface QuickAction {
  Icon: LucideIcon;
  label: string;
  key: string;
}

const QUICK_ACTIONS: QuickAction[] = [
  { Icon: Mail,           label: 'Préparer brouillons mail', key: 'draft-mails' },
  { Icon: AlertTriangle,  label: 'Voir les urgences',        key: 'see-urgent' },
  { Icon: Calendar,       label: 'Mes RDV du jour',           key: 'my-rdv' },
];

interface BriefingIAProps {
  counts: BriefingCounts;
  compact?: boolean;
}

// Souscription "no-op" + snapshot SSR vide → useSyncExternalStore renvoie ''
// côté server, puis l'heure courante côté client à l'hydratation. Permet
// d'éviter le warning react-hooks/set-state-in-effect tout en gardant un
// SSR neutre (pas de mismatch).
const NOOP_SUBSCRIBE = () => () => {};
const getClientTime = () =>
  new Date().toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });
const getServerTime = () => '';

export function BriefingIA({ counts, compact = false }: BriefingIAProps) {
  const generatedAt = useSyncExternalStore(NOOP_SUBSCRIBE, getClientTime, getServerTime);

  function handleAction(key: string) {
    // Sprint 1 : log pur. Sprint 2 : router push / server action.
    console.log('[BriefingIA] action déclenchée :', key);
  }

  return (
    <div
      className="rounded-[10px] overflow-hidden"
      style={{
        background: 'var(--color-cream)',
        boxShadow:
          '0 1px 2px rgba(15,32,64,0.04), 0 4px 12px rgba(15,32,64,0.05), 0 0 0 1px rgba(15,32,64,0.04)',
        borderLeft: '4px solid transparent',
        borderImage: 'linear-gradient(180deg, var(--color-navy), var(--color-navy-dark)) 1',
        borderImageSlice: 1,
      }}
    >
      {/* Fallback navy fixe sur le bord gauche pour les navigateurs qui
          galèrent avec border-image. Doublon visuel inoffensif. */}
      <div
        style={{ borderLeftWidth: 0 }}
        className="px-4 py-3.5"
      >
        {/* Header — badge "Claude FoxO" + titre + timestamp */}
        <div className="flex items-center gap-2 flex-wrap mb-2.5">
          <span
            className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-semibold tracking-[0.04em]"
            style={{
              background: 'var(--color-navy)',
              color: 'var(--color-cream)',
            }}
          >
            <span className="briefing-pulse-dot inline-block w-1.5 h-1.5 rounded-full"
              style={{ background: 'var(--color-cream)' }}
              aria-hidden
            />
            Claude FoxO
          </span>
          <h3 className="font-sora text-[13px] font-medium text-[var(--color-ink)] m-0 flex-1">
            Briefing du jour
          </h3>
          {generatedAt && (
            <span className="text-[10px] text-[var(--color-ink-muted)]">
              généré à {generatedAt}
            </span>
          )}
        </div>

        {/* Body — placeholder statique, deux variantes selon compact */}
        {compact ? (
          <BriefingBodyMobile counts={counts} />
        ) : (
          <BriefingBodyDesktop counts={counts} />
        )}

        {/* Quick actions — pills navy-pale, hover navy plein */}
        <div className="flex flex-wrap gap-1.5 mt-3">
          {QUICK_ACTIONS.map((a) => (
            <button
              key={a.key}
              type="button"
              onClick={() => handleAction(a.key)}
              className="briefing-pill inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] font-medium transition-colors"
              style={{
                background: 'var(--color-navy-pale)',
                color: 'var(--color-navy)',
                border: '1px solid var(--color-navy-light)',
                minHeight: 32,
              }}
            >
              <a.Icon size={12} aria-hidden />
              {a.label}
            </button>
          ))}
        </div>
      </div>

      <style>{`
        .briefing-pulse-dot {
          animation: briefingPulse 2s ease-in-out infinite;
        }
        @keyframes briefingPulse {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0.4; }
        }
        .briefing-pill:hover {
          background: var(--color-navy) !important;
          color: var(--color-cream) !important;
          border-color: var(--color-navy) !important;
        }
        .briefing-ref {
          font-family: var(--font-sora), ui-sans-serif, sans-serif;
          color: var(--color-navy);
          font-weight: 600;
          letter-spacing: 0.01em;
        }
      `}</style>
    </div>
  );
}

function BriefingBodyMobile({ counts }: { counts: BriefingCounts }) {
  return (
    <p className="text-[13px] text-[var(--color-ink)] leading-relaxed m-0">
      Tu as <strong>{counts.interventionsToday}</strong> intervention{counts.interventionsToday > 1 ? 's' : ''} confirmée{counts.interventionsToday > 1 ? 's' : ''} aujourd&apos;hui.{' '}
      <strong>{counts.urgences}</strong> urgence{counts.urgences > 1 ? 's' : ''} en attente méritent ton attention.{' '}
      <strong>{counts.mailsNonLus}</strong> mail{counts.mailsNonLus > 1 ? 's' : ''} sans réponse depuis +24h.{' '}
      Météo : pluie prévue cet après-midi.
    </p>
  );
}

function BriefingBodyDesktop({ counts }: { counts: BriefingCounts }) {
  return (
    <div className="space-y-2 text-[13px] text-[var(--color-ink)] leading-relaxed">
      <p className="m-0">
        Tu as <strong>{counts.interventionsToday}</strong> intervention{counts.interventionsToday > 1 ? 's' : ''} confirmée{counts.interventionsToday > 1 ? 's' : ''} aujourd&apos;hui (Belfius 9h, IG Syndic 11h30, Regimo 14h).{' '}
        <strong>{counts.urgences}</strong> urgence{counts.urgences > 1 ? 's' : ''} en attente depuis +48h méritent ton attention avant 10h&nbsp;:{' '}
        <span className="briefing-ref">Flagey II</span> et <span className="briefing-ref">ACP A10</span>.
      </p>
      <ul className="m-0 pl-4 space-y-1 list-disc text-[13px] text-[var(--color-ink-mid)]">
        <li>
          <strong className="text-[var(--color-ink)]">{counts.mailsNonLus}</strong> mail{counts.mailsNonLus > 1 ? 's' : ''} sans réponse depuis +24h — 1 du syndic Regimo qui menace de rebasculer chez la concurrence si pas de réponse aujourd&apos;hui.
        </li>
        <li>
          Facture <span className="briefing-ref">FACT-049</span> Belfius 1&nbsp;240&nbsp;€ en retard de 7 jours — relance recommandée maintenant.
        </li>
        <li>
          Pluie prévue cet après-midi : conditions idéales pour la détection par humidité sur le dossier <span className="briefing-ref">2026-123</span>.
        </li>
      </ul>
    </div>
  );
}
