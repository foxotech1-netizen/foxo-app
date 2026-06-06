'use client';

import { useEffect, useRef, useState } from 'react';
import { X, Sparkles, Clock, Sun, Mail, BarChart3, Zap, Pause, type LucideIcon } from 'lucide-react';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface QuickAction {
  label: string;
  prompt: string;
  icon?: LucideIcon;
}

export interface AssistantChatProps {
  mode: 'global' | 'intervention';
  interventionId?: string;
  // Optionnels : en mode global, des défauts internes sont utilisés si non
  // fournis. Un server component (page.tsx) ne peut pas passer d'icônes
  // lucide (fonctions) en props → elles vivent côté client ici.
  quickActions?: QuickAction[];
  emptyTitle?: string;
  emptyHint?: string;
  onSpecialResult?: (sections: { degats: string; inspection: string; conclusion: string; recommandations: string }) => void;
  className?: string;
  inputClassName?: string;
}

// Actions rapides du mode global — définies côté client (icônes lucide).
const GLOBAL_QUICK_ACTIONS: QuickAction[] = [
  { icon: Clock, label: 'Interventions en retard', prompt: 'Liste-moi les interventions en retard (créneau dépassé sans clôture). Pour chacune : ref, ACP, statut actuel, technicien assigné, et action recommandée.' },
  { icon: Sun, label: 'Résumé du jour', prompt: 'Donne-moi un résumé du programme d\'aujourd\'hui : interventions prévues avec heures et techniciens, alertes du moment, ce qui demande mon attention en priorité.' },
  { icon: Mail, label: 'Rédiger email syndic', prompt: 'Aide-moi à rédiger un email type pour un syndic. Demande-moi d\'abord le contexte (quelle intervention, quel objectif : confirmation RDV, demande d\'info, transmission rapport, etc.) puis propose un brouillon.' },
  { icon: BarChart3, label: 'Analyser l\'activité', prompt: 'Analyse l\'état du tableau de bord FoxO : équilibre par statut, charge des techniciens, dossiers qui patinent, urgences. Propose 3 actions concrètes à mener cette semaine.' },
  { icon: Zap, label: 'Urgences', prompt: 'Liste-moi les interventions urgentes non clôturées avec leur statut et ce qui bloque. Trie par priorité d\'action.' },
  { icon: Pause, label: 'En suspens', prompt: 'Liste les dossiers en suspens avec leur motif. Pour chacun, suggère une action de relance ou une décision à prendre.' },
];
const GLOBAL_EMPTY_TITLE = 'Comment puis-je t\'aider ?';
const GLOBAL_EMPTY_HINT = 'Je vois en direct l\'état des interventions, des syndics et du planning. Clique une action rapide ci-dessus, ou tape ta propre question.';

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

  // Défauts internes (mode global) si le parent ne fournit pas les props.
  const resolvedQuickActions = quickActions ?? (mode === 'global' ? GLOBAL_QUICK_ACTIONS : []);
  const resolvedEmptyTitle = emptyTitle ?? GLOBAL_EMPTY_TITLE;
  const resolvedEmptyHint = emptyHint ?? GLOBAL_EMPTY_HINT;

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
        {resolvedQuickActions.map((qa) => {
          const Icon = qa.icon;
          return (
            <button
              key={qa.label}
              type="button"
              onClick={() => handleQuickAction(qa)}
              disabled={pending}
              className="bg-white border border-sand-border hover:border-navy-mid hover:bg-navy-pale text-ink-mid hover:text-navy text-[11px] font-semibold px-2.5 py-1.5 rounded-md disabled:opacity-50 transition-colors inline-flex items-center gap-1.5 dark:bg-[rgba(255,255,255,.08)] dark:border-[rgba(255,255,255,.15)] dark:hover:bg-[rgba(255,255,255,.15)] dark:hover:border-[rgba(255,255,255,.25)] dark:hover:text-white"
            >
              {Icon ? <Icon size={14} /> : null}
              {qa.label}
            </button>
          );
        })}
        {messages.length > 0 && (
          <button
            type="button"
            onClick={clearChat}
            className="ml-auto bg-sand-mid text-ink-muted hover:text-terra text-[11px] font-semibold px-2.5 py-1.5 rounded-md inline-flex items-center gap-1.5 dark:bg-[rgba(255,255,255,.06)]"
          >
            <X size={14} />
            Effacer
          </button>
        )}
      </div>

      {/* Zone messages */}
      <div ref={scrollerRef} className="flex-1 overflow-y-auto bg-white border border-sand-border rounded-xl p-3 mb-3 min-h-[260px]">
        {messages.length === 0 && !pending && (
          <div className="h-full flex flex-col items-center justify-center text-center py-8">
            <Sparkles size={28} className="mb-2 text-ink-muted" aria-hidden />
            <div className="text-[14px] font-bold text-ink mb-1">{resolvedEmptyTitle}</div>
            <p className="text-[12px] text-ink-muted max-w-[400px]">{resolvedEmptyHint}</p>
          </div>
        )}

        <div className="space-y-3">
          {messages.map((m, i) => (
            <div
              key={i}
              className={
                m.role === 'user'
                  ? 'ml-8 bg-navy-pale border border-navy-light rounded-lg px-3 py-2'
                  : 'mr-8 bg-cream border border-sand-border rounded-lg px-3 py-2'
              }
            >
              <div className="text-[10px] uppercase tracking-wider font-bold mb-1 text-ink-muted inline-flex items-center gap-1">
                {m.role === 'user' ? 'Vous' : (<><Sparkles size={12} aria-hidden /> Claude</>)}
              </div>
              <div className="text-[13px] text-ink whitespace-pre-wrap leading-relaxed">{m.content}</div>
              {m.role === 'assistant' && (
                <div className="flex gap-2 mt-2">
                  <button
                    type="button"
                    onClick={() => copyToClipboard(m.content)}
                    className="text-[10px] text-ink-muted hover:text-navy underline"
                  >
                    Copier
                  </button>
                  {i === messages.length - 1 && lastSections && onSpecialResult && (
                    <button
                      type="button"
                      onClick={pushSectionsToParent}
                      className="text-[10px] text-ok hover:underline font-bold"
                    >
                      → Sauvegarder comme brouillon de rapport
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
          {pending && (
            <div className="mr-8 bg-cream border border-sand-border rounded-lg px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider font-bold mb-1 text-ink-muted inline-flex items-center gap-1">
                <Sparkles size={12} aria-hidden /> Claude
              </div>
              <div className="text-[13px] text-ink-muted italic">Réflexion en cours…</div>
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
          className={inputClassName ?? 'flex-1 px-3 py-2.5 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid disabled:opacity-50'}
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
