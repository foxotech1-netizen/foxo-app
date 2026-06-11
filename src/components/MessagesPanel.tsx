'use client';

import { TZ_BRUSSELS } from '@/lib/format';
import { useEffect, useRef, useState } from 'react';
import { MessageCircle } from 'lucide-react';

// Une bulle = un message. auteur_type 'admin' = côté FoxO, le reste
// (syndic/courtier/expert) = côté partenaire.
export interface Message {
  id: string;
  intervention_id: string;
  auteur_type: 'admin' | 'syndic' | 'courtier' | 'expert';
  auteur_email: string;
  contenu: string;
  created_at: string;
  lu_admin: boolean;
  lu_syndic: boolean;
}

// Libellé de rôle affiché sous chaque bulle.
const AUTEUR_LABEL: Record<Message['auteur_type'], string> = {
  admin: 'FoxO',
  syndic: 'Syndic',
  courtier: 'Courtier',
  expert: 'Expert',
};

const POLL_MS = 30_000;

function relTime(iso: string, now: number): string {
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return '—';
  const diffSec = Math.max(0, Math.floor((now - ts) / 1000));
  if (diffSec < 60) return 'à l\'instant';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `il y a ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `il y a ${diffH} h`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `il y a ${diffD} j`;
  return new Date(iso).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function MessagesPanel({
  interventionId,
  currentUserEmail,
  isAdmin,
}: {
  interventionId: string;
  currentUserEmail: string;
  isAdmin: boolean;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newText, setNewText] = useState('');
  const [sending, setSending] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const endRef = useRef<HTMLDivElement>(null);
  const markedRef = useRef<Set<string>>(new Set());

  // Fetch + polling 30s. Pas de queueMicrotask : les setState sont à
  // l'intérieur de la fonction async (pas dans le body sync de l'effect).
  useEffect(() => {
    let cancelled = false;
    async function fetchMessages() {
      try {
        const r = await fetch(`/api/messages?intervention_id=${interventionId}`, { cache: 'no-store' });
        const d = await r.json();
        if (cancelled) return;
        if (d.ok) {
          setMessages(d.messages as Message[]);
          setError(null);
        } else {
          setError(d.error ?? 'Erreur de chargement.');
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Erreur réseau.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchMessages();
    const id = setInterval(fetchMessages, POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [interventionId]);

  // Re-render toutes les 30s pour rafraîchir les "il y a N min".
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Auto-scroll vers le bas à chaque nouveau message.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length]);

  // Marque les messages reçus comme lus côté caller. Fire-and-forget,
  // dédupliqué via markedRef pour éviter les re-PATCH au polling.
  useEffect(() => {
    const toMark = messages.filter((m) => {
      if (markedRef.current.has(m.id)) return false;
      if (isAdmin) {
        return !m.lu_admin && m.auteur_type !== 'admin';
      } else {
        return !m.lu_syndic && m.auteur_type === 'admin';
      }
    });
    for (const m of toMark) {
      markedRef.current.add(m.id);
      fetch(`/api/messages/${m.id}/lu`, { method: 'PATCH' }).catch(() => {
        // Si échec, retire du set pour permettre un nouvel essai au prochain poll
        markedRef.current.delete(m.id);
      });
    }
  }, [messages, isAdmin]);

  async function send(e?: React.FormEvent) {
    if (e) e.preventDefault();
    const contenu = newText.trim();
    if (!contenu || sending) return;
    setSending(true);
    setError(null);
    try {
      const r = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intervention_id: interventionId, contenu }),
      });
      const d = await r.json();
      if (!d.ok) {
        setError(d.error ?? 'Échec envoi.');
        return;
      }
      // Optimistic : ajoute en bas. Le prochain poll dédoublonnera si
      // besoin (l'INSERT a un id unique).
      setMessages((arr) => [...arr, d.message as Message]);
      setNewText('');
    } finally {
      setSending(false);
    }
  }

  return (
    <section
      id="messages-block"
      className="bg-cream border border-sand-border rounded-2xl p-5 dark:bg-[#1C1A16] dark:border-[#2C2A24]"
    >
      <h2 className="text-sm font-bold text-ink mb-3 dark:text-[#F0ECE4] inline-flex items-center gap-1.5"><MessageCircle size={14} /> Messages</h2>

      {/* Liste des messages */}
      <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1 mb-3">
        {loading ? (
          <MessageSkeleton />
        ) : messages.length === 0 ? (
          <p className="text-[13px] text-ink-muted italic dark:text-[#C8C2B8]">
            Aucun message pour ce dossier.
          </p>
        ) : (
          messages.map((m) => {
            // Bulle "moi" = même email que currentUserEmail (cas le plus
            // courant). Sinon on aligne par auteur_type (admin = droite
            // si on est admin, gauche sinon).
            const isMine = m.auteur_email.toLowerCase() === currentUserEmail.toLowerCase();
            const isFromAdmin = m.auteur_type === 'admin';
            // Convention : admin à droite côté admin, à gauche côté syndic.
            const alignRight = isAdmin ? isFromAdmin : !isFromAdmin && isMine;
            return (
              <div key={m.id} className={'flex ' + (alignRight ? 'justify-end' : 'justify-start')}>
                <div className={'max-w-[80%] ' + (alignRight ? 'items-end' : 'items-start')}>
                  <div
                    className={
                      'rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed whitespace-pre-wrap ' +
                      (isFromAdmin
                        ? 'bg-navy text-white'
                        : 'bg-sand-mid text-ink dark:bg-[#2A2520] dark:text-[#F0ECE4]')
                    }
                  >
                    {m.contenu}
                  </div>
                  <div
                    className={
                      'text-[10px] text-ink-muted mt-0.5 dark:text-[#8A8278] ' +
                      (alignRight ? 'text-right' : 'text-left')
                    }
                    title={`${m.auteur_email} · ${new Date(m.created_at).toLocaleString('fr-BE', { timeZone: TZ_BRUSSELS })}`}
                  >
                    {AUTEUR_LABEL[m.auteur_type]} · {relTime(m.created_at, now)}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>

      {error && (
        <div className="mb-2 px-3 py-1.5 bg-terra-light border border-terra-mid text-terra rounded-md text-[11px] font-semibold">
          {error}
        </div>
      )}

      {/* Form envoi */}
      <form onSubmit={send} className="flex flex-col sm:flex-row gap-2">
        <textarea
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          onKeyDown={(e) => {
            // Cmd/Ctrl+Enter envoie (pratique sur desktop).
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              send();
            }
          }}
          disabled={sending}
          rows={2}
          placeholder="Écrire un message…"
          className="flex-1 px-3 py-2 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid resize-y dark:bg-[#221E1A] dark:border-[#3D3A32] dark:text-[#F0ECE4]"
        />
        <button
          type="submit"
          disabled={sending || !newText.trim()}
          className="bg-navy text-white px-4 py-2 rounded-lg text-[12px] font-bold hover:opacity-90 disabled:opacity-50 self-end sm:self-auto"
        >
          {sending ? '…' : 'Envoyer'}
        </button>
      </form>
    </section>
  );
}

function MessageSkeleton() {
  return (
    <div className="space-y-2">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className={'flex ' + (i % 2 === 0 ? 'justify-start' : 'justify-end')}
        >
          <div className="bg-sand-mid rounded-2xl h-10 w-2/3 animate-pulse dark:bg-[#2A2520]" />
        </div>
      ))}
    </div>
  );
}
