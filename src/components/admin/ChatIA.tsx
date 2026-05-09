'use client';

// ChatIA — chat EXPRESS du Tableau de bord (raccourci 1-question/
// 1-réponse). La page /admin/assistant reste la surface dédiée aux
// sessions longues avec historique. Si une question dans ce chat
// express devient complexe ou nécessite plusieurs tours, on suggérera
// dans la réponse un lien "Continuer dans l'Assistant →"
// (à implémenter Sprint 2).
//
// ⚠ Sprint 1 : UI uniquement, onSubmit = console.log + toast inline.
// Sprint 2 : brancher onSubmit sur server action `sendChatMessage(message)`
// (Anthropic SDK), puis streamer la réponse.

import { useEffect, useState } from 'react';
import { Send, ChevronDown, Sparkles } from 'lucide-react';

const SUGGESTIONS = [
  'Résume mes mails non lus',
  'Quels dossiers sont bloqués ?',
  'Brouillon réponse Regimo',
  'Préparer le RDV de 14h',
];

interface ChatIAProps {
  compact?: boolean;
}

export function ChatIA({ compact = false }: ChatIAProps) {
  const [value, setValue] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(!compact);
  const [toast, setToast] = useState<string | null>(null);

  // Quand le breakpoint change (compact desktop → mobile), on resync
  // l'état d'ouverture par défaut. Sinon le chat resterait dans son
  // état initial même après resize.
  useEffect(() => {
    setShowSuggestions(!compact);
  }, [compact]);

  // Auto-dismiss toast (mêmes 3.5s que la convention NewMailSection).
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = value.trim();
    if (!q) return;
    console.log('[ChatIA] question soumise (Sprint 2 branchera Claude) :', q);
    setToast('Cette fonctionnalité arrive bientôt — branchement Claude au Sprint 2.');
    setValue('');
  }

  function handleSuggestion(s: string) {
    setValue(s);
  }

  return (
    <div
      className="rounded-[10px] overflow-hidden"
      style={{
        background: 'var(--color-cream)',
        boxShadow:
          '0 1px 2px rgba(15,32,64,0.04), 0 4px 12px rgba(15,32,64,0.05), 0 0 0 1px rgba(15,32,64,0.04)',
      }}
    >
      <div className="px-4 py-3.5">
        {/* Header — badge + intitulé */}
        <div className="flex items-center gap-2 flex-wrap mb-2.5">
          <span
            className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-semibold tracking-[0.04em]"
            style={{
              background: 'var(--color-navy-pale)',
              color: 'var(--color-navy-dark)',
            }}
          >
            <Sparkles size={11} aria-hidden />
            Claude FoxO
          </span>
          <h3 className="font-sora text-[13px] font-medium text-[var(--color-ink)] m-0 flex-1">
            Pose-moi une question sur tes dossiers, mails ou planning
          </h3>
        </div>

        {/* Input pill (rounded-full) + bouton send circulaire */}
        <form onSubmit={handleSubmit}>
          <div
            className="chat-pill relative flex items-center"
            style={{
              background: 'var(--color-sand)',
              border: '1px solid var(--color-sand-border)',
              borderRadius: 9999,
              paddingLeft: 14,
              paddingRight: 4,
              paddingTop: 4,
              paddingBottom: 4,
              transition: 'border-color 0.15s, box-shadow 0.15s',
            }}
          >
            <input
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Ex: Quels syndics n'ont pas répondu cette semaine ?"
              className="flex-1 bg-transparent border-0 outline-none text-[13px] italic placeholder:text-[var(--color-ink-muted)] py-2"
              style={{ color: 'var(--color-ink)', minWidth: 0, minHeight: 36 }}
              aria-label="Question express à Claude"
            />
            <button
              type="submit"
              disabled={!value.trim()}
              className="flex-shrink-0 inline-flex items-center justify-center transition-opacity disabled:opacity-40"
              style={{
                width: 30,
                height: 30,
                borderRadius: '50%',
                background: 'var(--color-navy)',
                color: 'var(--color-cream)',
              }}
              aria-label="Envoyer"
            >
              <Send size={14} aria-hidden />
            </button>
          </div>
        </form>

        {/* Suggestions — mobile : repliables ; desktop : visibles */}
        {compact && !showSuggestions && (
          <button
            type="button"
            onClick={() => setShowSuggestions(true)}
            className="mt-2 text-[11px] font-medium text-[var(--color-navy)] inline-flex items-center gap-1 hover:underline"
          >
            <ChevronDown size={12} aria-hidden />
            Voir les suggestions
          </button>
        )}

        {showSuggestions && (
          <div className="flex flex-wrap gap-1.5 mt-2.5">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => handleSuggestion(s)}
                className="chat-suggestion-pill inline-flex items-center px-2.5 py-1.5 rounded-full text-[11px] font-medium transition-colors"
                style={{
                  background: 'var(--color-navy-pale)',
                  color: 'var(--color-navy)',
                  border: '1px solid var(--color-navy-light)',
                  minHeight: 32,
                }}
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {toast && (
          <div
            className="mt-2.5 px-3 py-2 text-[11px] font-medium rounded-md border"
            style={{
              background: 'var(--color-amber-light)',
              borderColor: 'rgba(184, 131, 10, 0.3)',
              color: 'var(--color-amber-foxo)',
            }}
          >
            {toast}
          </div>
        )}
      </div>

      <style>{`
        .chat-pill:focus-within {
          border-color: var(--color-navy) !important;
          box-shadow: 0 0 0 3px var(--color-navy-pale);
        }
        .chat-suggestion-pill:hover {
          background: var(--color-navy) !important;
          color: var(--color-cream) !important;
          border-color: var(--color-navy) !important;
        }
      `}</style>
    </div>
  );
}
