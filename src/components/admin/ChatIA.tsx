'use client';

// ChatIA — chat EXPRESS du Tableau de bord, branché sur l'assistant FoxO.
// Envoie les messages à /api/admin/assistant/chat (mode global) : la boucle
// d'outils (interventions, mails, agenda) s'exécute côté serveur. Pour les
// sessions longues avec historique complet, lien "Continuer dans l'Assistant".

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Send, ChevronDown, Sparkles, ArrowRight } from 'lucide-react';

const SUGGESTIONS = [
  'Résume mes mails non lus',
  'Quels dossiers sont bloqués ?',
  'Brouillon réponse Regimo',
  'Préparer le RDV de 14h',
];

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatIAProps {
  compact?: boolean;
}

export function ChatIA({ compact = false }: ChatIAProps) {
  const [value, setValue] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const hasConversation = messages.length > 0;
  const showSuggestions = (!compact || manualOpen) && !hasConversation;

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, loading]);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || loading) return;
    setValue('');
    const next: ChatMessage[] = [...messages, { role: 'user', content: q }];
    setMessages(next);
    setLoading(true);
    try {
      const res = await fetch('/api/admin/assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'global', messages: next }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        setToast(data?.error || 'Réponse indisponible pour le moment.');
        return;
      }
      setMessages([...next, { role: 'assistant', content: String(data.content ?? '') }]);
    } catch {
      setToast('Erreur réseau : réessaie dans un instant.');
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    void ask(value);
  }

  function handleSuggestion(s: string) {
    void ask(s);
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
            Assistant FoxO
          </span>
          <h3 className="font-sora text-[13px] font-medium text-[var(--color-ink)] m-0 flex-1">
            Pose-moi une question sur tes dossiers, mails ou planning
          </h3>
        </div>

        {/* Zone conversation (apparaît dès le premier échange) */}
        {hasConversation && (
          <div
            ref={scrollRef}
            className="flex flex-col gap-2 mb-2.5"
            style={{ maxHeight: 260, overflowY: 'auto', paddingRight: 4 }}
          >
            {messages.map((m, i) => (
              <div
                key={i}
                className={m.role === 'user' ? 'self-end max-w-[85%]' : 'self-start max-w-[92%]'}
                style={{
                  padding: '8px 12px',
                  borderRadius: 14,
                  fontSize: 12,
                  lineHeight: 1.5,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  background: m.role === 'user' ? 'var(--color-navy)' : 'var(--color-sand)',
                  color: m.role === 'user' ? 'var(--color-cream)' : 'var(--color-ink)',
                  border: m.role === 'user' ? 'none' : '1px solid var(--color-sand-border)',
                }}
              >
                {m.content}
              </div>
            ))}
            {loading && (
              <div className="self-start text-[11px] italic" style={{ color: 'var(--color-ink-muted)' }}>
                L&apos;assistant réfléchit…
              </div>
            )}
          </div>
        )}

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
              disabled={loading}
              placeholder="Ex: Quels syndics n'ont pas répondu cette semaine ?"
              className="flex-1 bg-transparent border-0 outline-none text-[13px] italic placeholder:text-[var(--color-ink-muted)] py-2"
              style={{ color: 'var(--color-ink)', minWidth: 0, minHeight: 36 }}
              aria-label="Question express à Assistant FoxO"
            />
            <button
              type="submit"
              disabled={!value.trim() || loading}
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

        {/* Suggestions — mobile : repliables ; desktop : visibles ; cachées dès qu'une conversation existe */}
        {compact && !manualOpen && !hasConversation && (
          <button
            type="button"
            onClick={() => setManualOpen(true)}
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
                disabled={loading}
                className="chat-suggestion-pill inline-flex items-center px-2.5 py-1.5 rounded-full text-[11px] font-medium transition-colors disabled:opacity-50"
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

        {/* Lien vers l'assistant complet (dès qu'une conversation existe) */}
        {hasConversation && (
          <Link
            href="/admin/assistant"
            className="mt-2.5 inline-flex items-center gap-1 text-[11px] font-medium hover:underline"
            style={{ color: 'var(--color-navy)' }}
          >
            Continuer dans l&apos;Assistant
            <ArrowRight size={12} aria-hidden />
          </Link>
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
