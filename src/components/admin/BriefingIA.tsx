'use client';

// BriefingIA — card du Tableau de bord admin présentant le briefing
// quotidien généré par Claude FoxO.
//
// Le texte (`briefingText`) est produit côté serveur par getBriefing()
// (src/lib/assistant/briefing.ts) à partir du contexte FoxO temps réel,
// mis en cache 1 h. Ce composant n'affiche que du contenu réel — plus
// aucun placeholder statique.

import { useSyncExternalStore } from 'react';
import { Mail, AlertTriangle, Calendar, type LucideIcon } from 'lucide-react';

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
  briefingText: string;
  // Réservé pour d'éventuels ajustements responsive ; le texte étant déjà
  // concis, le rendu est identique mobile/desktop pour l'instant.
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

export function BriefingIA({ briefingText }: BriefingIAProps) {
  const generatedAt = useSyncExternalStore(NOOP_SUBSCRIBE, getClientTime, getServerTime);

  function handleAction(key: string) {
    // Quick actions non branchées pour l'instant (log pur).
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

        {/* Body — texte réel généré par Claude */}
        <p className="text-[13px] text-[var(--color-ink)] leading-relaxed m-0 whitespace-pre-line">
          {briefingText}
        </p>

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
      `}</style>
    </div>
  );
}
