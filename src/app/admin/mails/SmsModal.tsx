'use client';

// Modal SMS — affiche le brouillon généré par /api/admin/sms/compose,
// permet édition (téléphone + body avec compteur 160), envoi via
// /api/admin/sms/send. Pas d'envoi automatique : l'admin valide.

import { useState } from 'react';
import { X } from 'lucide-react';

interface Props {
  threadId: string;
  initialPhone: string;
  initialBody: string;
  onClose: () => void;
  onSent: (sid: string) => void;
}

export function SmsModal({ threadId, initialPhone, initialBody, onClose, onSent }: Props) {
  const [phone, setPhone] = useState(initialPhone);
  const [body, setBody] = useState(initialBody);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const charCount = body.length;
  const segments = Math.max(1, Math.ceil(charCount / 160));
  const overLimit = charCount > 320;

  async function handleSend() {
    if (!phone.trim() || !body.trim()) {
      setError('Téléphone + message requis.');
      return;
    }
    if (overLimit) {
      setError('Message trop long (>320 chars).');
      return;
    }
    setSending(true);
    setError(null);
    try {
      const r = await fetch('/api/admin/sms/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, body, thread_id: threadId }),
      });
      const data = await r.json();
      if (!data.success) {
        setError(data.error ?? 'Échec envoi SMS.');
        return;
      }
      onSent(data.sid as string);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur réseau.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget && !sending) onClose(); }}
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: 'rgba(15, 32, 64, 0.45)' }}
    >
      <div
        className="w-full max-w-[500px] max-h-[90vh] flex flex-col rounded-[10px] overflow-hidden"
        style={{
          background: 'var(--color-cream)',
          boxShadow: '0 1px 2px rgba(15,32,64,0.06), 0 12px 32px rgba(15,32,64,0.18), 0 0 0 1px rgba(15,32,64,0.06)',
        }}
      >
        <div
          className="flex items-center justify-between px-5 py-3 border-b"
          style={{ borderColor: 'var(--color-sand-mid)' }}
        >
          <h2 className="font-sora text-[14px] font-semibold m-0" style={{ color: 'var(--color-ink)' }}>
            Confirmer occupant — SMS
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            aria-label="Fermer"
            className="w-7 h-7 inline-flex items-center justify-center rounded disabled:opacity-50"
            style={{ color: 'var(--color-ink-mid)' }}
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3 flex-1 min-h-0 overflow-y-auto">
          <label className="block">
            <span className="text-[11px] font-medium uppercase tracking-wider" style={{ color: 'var(--color-ink-muted)' }}>
              Téléphone
            </span>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={sending}
              className="w-full mt-1 px-3 py-2 rounded text-[13px] outline-none disabled:opacity-50"
              style={{
                background: 'var(--color-sand)',
                border: '1px solid var(--color-sand-border)',
                color: 'var(--color-ink)',
              }}
            />
          </label>

          <label className="block">
            <span className="text-[11px] font-medium uppercase tracking-wider flex items-center justify-between" style={{ color: 'var(--color-ink-muted)' }}>
              <span>Message SMS</span>
              <span style={{ color: overLimit ? 'var(--color-terra)' : 'var(--color-ink-muted)' }}>
                {charCount} / 160 ({segments} SMS)
              </span>
            </span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              disabled={sending}
              rows={5}
              className="w-full mt-1 px-3 py-2 rounded text-[13px] outline-none resize-y disabled:opacity-50"
              style={{
                background: 'var(--color-sand)',
                border: `1px solid ${overLimit ? 'var(--color-terra)' : 'var(--color-sand-border)'}`,
                color: 'var(--color-ink)',
              }}
            />
          </label>

          {error && (
            <div
              className="px-3 py-2 rounded text-[12px] font-medium"
              style={{
                background: 'var(--color-terra-light)',
                border: '1px solid var(--color-terra-mid)',
                color: 'var(--color-terra)',
              }}
            >
              {error}
            </div>
          )}
        </div>

        <div
          className="flex justify-end gap-2 px-5 py-3 border-t"
          style={{ borderColor: 'var(--color-sand-mid)' }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            className="px-3.5 py-2 rounded-md text-[12px] font-medium transition-colors disabled:opacity-50"
            style={{
              background: 'var(--color-cream)',
              border: '1px solid var(--color-sand-border)',
              color: 'var(--color-ink-mid)',
            }}
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={handleSend}
            disabled={sending || overLimit}
            className="px-3.5 py-2 rounded-md text-[12px] font-medium transition-colors disabled:opacity-50"
            style={{
              background: 'var(--color-navy)',
              color: 'var(--color-cream)',
            }}
          >
            {sending ? 'Envoi…' : 'Envoyer maintenant'}
          </button>
        </div>
      </div>
    </div>
  );
}
