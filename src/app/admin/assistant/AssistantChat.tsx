'use client';

import { useEffect, useRef, useState } from 'react';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface QuickAction {
  label: string;
  prompt: string;
  icon?: string;
}

export interface AssistantChatProps {
  mode: 'global' | 'intervention';
  interventionId?: string;
  quickActions: QuickAction[];
  emptyTitle: string;
  emptyHint: string;
  onSpecialResult?: (sections: { degats: string; inspection: string; conclusion: string; recommandations: string }) => void;
  className?: string;
  inputClassName?: string;
}

interface ApiResponse {
  ok: boolean;
  content?: string;
  error?: string;
  warning?: string;
  sections?: { degats: string; inspection: string; conclusion: string; recommandations: string };
}

export function AssistantChat({
  mode,
  interventionId,
  quickActions,
  emptyTitle,
  emptyHint,
  onSpecialResult,
  className,
  inputClassName,
}: AssistantChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSections, setLastSections] = useState<NonNullable<ApiResponse['sections']> | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, pending]);

  async function send(content: string, format: 'text' | 'rapport_json' = 'text') {
    if (!content.trim() || pending) return;
    setError(null);
    setLastSections(null);
    const newUserMsg: ChatMessage = { role: 'user', content };
    const next = [...messages, newUserMsg];
    setMessages(next);
    setInput('');
    setPending(true);
    try {
      const res = await fetch('/api/admin/assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          interventionId,
          messages: next,
          format,
        }),
      });
      const data = (await res.json()) as ApiResponse;
      if (!data.ok || !data.content) {
        setError(data.error ?? 'Erreur inconnue.');
        // Retire le message utilisateur en attente d'un retry possible
        setMessages(next);
        return;
      }
      setMessages([...next, { role: 'assistant', content: data.content }]);
      if (data.sections) {
        setLastSections(data.sections);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur réseau.');
      setMessages(next);
    } finally {
      setPending(false);
    }
  }

  function handleQuickAction(qa: QuickAction) {
    const isRapport = /rédige.*rapport|rédiger.*rapport|génère.*rapport/i.test(qa.prompt);
    send(qa.prompt, isRapport ? 'rapport_json' : 'text');
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (input.trim()) send(input.trim());
  }

  function copyToClipboard(text: string) {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(text);
    }
  }

  function pushSectionsToParent() {
    if (lastSections && onSpecialResult) {
      onSpecialResult(lastSections);
    }
  }

  function clearChat() {
    if (messages.length === 0) return;
    if (!confirm('Effacer la conversation ?')) return;
    setMessages([]);
    setError(null);
    setLastSections(null);
  }

  return (
    <div className={className ?? 'flex flex-col h-full'}>
      {/* Actions rapides */}
      <div className="flex flex-wrap gap-1.5 mb-3 flex-shrink-0">
        {quickActions.map((qa) => (
          <button
            key={qa.label}
            type="button"
            onClick={() => handleQuickAction(qa)}
            disabled={pending}
            className="bg-white border border-sand-border hover:border-navy-mid hover:bg-navy-pale text-ink-mid hover:text-navy text-[11px] font-semibold px-2.5 py-1.5 rounded-md disabled:opacity-50 transition-colors dark:bg-[rgba(255,255,255,.08)] dark:border-[rgba(255,255,255,.15)] dark:text-[#F0ECE4] dark:hover:bg-[rgba(255,255,255,.15)] dark:hover:border-[rgba(255,255,255,.25)] dark:hover:text-white"
          >
            {qa.icon ? `${qa.icon} ` : ''}{qa.label}
          </button>
        ))}
        {messages.length > 0 && (
          <button
            type="button"
            onClick={clearChat}
            className="ml-auto bg-sand-mid text-ink-muted hover:text-terra text-[11px] font-semibold px-2.5 py-1.5 rounded-md dark:bg-[rgba(255,255,255,.06)] dark:text-[#C8C2B8] dark:hover:text-[#E8C896]"
          >
            ✕ Effacer
          </button>
        )}
      </div>

      {/* Zone messages */}
      <div ref={scrollerRef} className="flex-1 overflow-y-auto bg-white border border-sand-border rounded-xl p-3 mb-3 min-h-[260px] dark:bg-[#1C1A16] dark:border-[#2C2A24]">
        {messages.length === 0 && !pending && (
          <div className="h-full flex flex-col items-center justify-center text-center py-8">
            <div className="text-3xl mb-2">✨</div>
            <div className="text-[14px] font-bold text-ink mb-1 dark:text-[#F0ECE4]">{emptyTitle}</div>
            <p className="text-[12px] text-ink-muted max-w-[400px] dark:text-[#C8C2B8]">{emptyHint}</p>
          </div>
        )}

        <div className="space-y-3">
          {messages.map((m, i) => (
            <div
              key={i}
              className={
                m.role === 'user'
                  ? 'ml-8 bg-navy-pale border border-navy-light rounded-lg px-3 py-2 dark:bg-[#1B3A6B] dark:border-[#2A5298]'
                  : 'mr-8 bg-cream border border-sand-border rounded-lg px-3 py-2 dark:bg-[#221E1A] dark:border-[#3D3A32]'
              }
            >
              <div className="text-[10px] uppercase tracking-wider font-bold mb-1 text-ink-muted dark:text-[#C8C2B8]">
                {m.role === 'user' ? 'Vous' : '✨ Claude'}
              </div>
              <div className="text-[13px] text-ink whitespace-pre-wrap leading-relaxed dark:text-[#F0ECE4]">{m.content}</div>
              {m.role === 'assistant' && (
                <div className="flex gap-2 mt-2">
                  <button
                    type="button"
                    onClick={() => copyToClipboard(m.content)}
                    className="text-[10px] text-ink-muted hover:text-navy underline dark:text-[#C8C2B8] dark:hover:text-[#A8C4F2]"
                  >
                    Copier
                  </button>
                  {i === messages.length - 1 && lastSections && onSpecialResult && (
                    <button
                      type="button"
                      onClick={pushSectionsToParent}
                      className="text-[10px] text-ok hover:underline font-bold dark:text-[#7AC9A0]"
                    >
                      → Sauvegarder comme brouillon de rapport
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
          {pending && (
            <div className="mr-8 bg-cream border border-sand-border rounded-lg px-3 py-2 dark:bg-[#221E1A] dark:border-[#3D3A32]">
              <div className="text-[10px] uppercase tracking-wider font-bold mb-1 text-ink-muted dark:text-[#C8C2B8]">
                ✨ Claude
              </div>
              <div className="text-[13px] text-ink-muted italic dark:text-[#C8C2B8]">Réflexion en cours…</div>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-terra-light border border-terra-mid text-terra text-[12px] rounded-lg px-3 py-2 mb-2 font-semibold flex-shrink-0">
          {error}
        </div>
      )}

      {/* Input */}
      <form onSubmit={handleSubmit} className="flex gap-2 flex-shrink-0">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={mode === 'global' ? 'Pose une question sur l\'activité FoxO…' : 'Pose une question sur ce dossier…'}
          disabled={pending}
          className={inputClassName ?? 'flex-1 px-3 py-2.5 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid disabled:opacity-50 dark:bg-[#221E1A] dark:border-[#3D3A32] dark:text-[#F0ECE4] dark:placeholder:text-[#8A8278]'}
        />
        <button
          type="submit"
          disabled={pending || !input.trim()}
          className="bg-navy text-white px-4 py-2.5 rounded-lg text-[13px] font-bold hover:opacity-90 disabled:opacity-50"
        >
          {pending ? '…' : 'Envoyer'}
        </button>
      </form>
    </div>
  );
}
