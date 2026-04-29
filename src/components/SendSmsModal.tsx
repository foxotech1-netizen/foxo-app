'use client';

import { useEffect, useState, useTransition } from 'react';
import { sendSmsAction, buildSmsPreview } from '@/app/admin/sms/actions';
import type { ContactPreference } from '@/lib/types/database';

// Estimation simple du coût SMS (mêmes constantes que src/lib/sms.ts).
function estimateSmsCost(message: string): { segments: number; eur: number } {
  if (!message) return { segments: 0, eur: 0 };
  const len = message.length;
  const isUnicode = /[^\x00-\x7F€£]/.test(message);
  const single = isUnicode ? 70 : 160;
  const concat = isUnicode ? 67 : 153;
  const segments = len <= single ? 1 : Math.ceil(len / concat);
  return { segments, eur: Math.round(segments * 0.05 * 100) / 100 };
}

export interface SendSmsModalProps {
  open: boolean;
  onClose: () => void;
  recipientName: string;
  recipientPhone: string;        // brut, formaté côté serveur
  initialMessage?: string;       // si fourni, override le template
  templateKey?: 'sms_template_confirmation' | 'sms_template_rappel_24h' | 'sms_template_rapport' | 'sms_template_lien_occupant';
  interventionId?: string;
  occupantId?: string;
  preferredChannel?: ContactPreference | null;  // si 'whatsapp' → bascule WhatsApp par défaut
}

export function SendSmsModal({
  open,
  onClose,
  recipientName,
  recipientPhone,
  initialMessage,
  templateKey,
  interventionId,
  occupantId,
  preferredChannel,
}: SendSmsModalProps) {
  const [message, setMessage] = useState(initialMessage ?? '');
  const [defaultMessage, setDefaultMessage] = useState(initialMessage ?? '');
  const [channel, setChannel] = useState<'sms' | 'whatsapp'>(
    preferredChannel === 'whatsapp' ? 'whatsapp' : 'sms',
  );
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  // Charge le preview depuis le serveur si templateKey + interventionId
  useEffect(() => {
    if (!open) return;
    if (initialMessage) {
      setMessage(initialMessage);
      setDefaultMessage(initialMessage);
      return;
    }
    if (!templateKey || !interventionId) return;
    setLoadingPreview(true);
    buildSmsPreview({ template_key: templateKey, intervention_id: interventionId, occupant_id: occupantId ?? null })
      .then((res) => {
        if (res.ok && res.data) {
          setMessage(res.data.message);
          setDefaultMessage(res.data.message);
          if (preferredChannel == null) setChannel(res.data.channel);
        } else if (!res.ok) {
          setFeedback({ kind: 'err', msg: res.error });
        }
      })
      .finally(() => setLoadingPreview(false));
  }, [open, templateKey, interventionId, occupantId, initialMessage, preferredChannel]);

  if (!open) return null;

  const cost = estimateSmsCost(message);

  function handleSend() {
    setFeedback(null);
    startTransition(async () => {
      const res = await sendSmsAction({
        to: recipientPhone,
        channel,
        message,
        intervention_id: interventionId,
        occupant_id: occupantId,
      });
      if (!res.ok) {
        setFeedback({ kind: 'err', msg: res.error });
        return;
      }
      setFeedback({ kind: 'ok', msg: 'Envoyé ✓' });
      setTimeout(onClose, 800);
    });
  }

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-cream w-full sm:max-w-[520px] sm:rounded-2xl rounded-t-2xl border border-sand-border max-h-[90vh] flex flex-col shadow-2xl dark:bg-[#1C1A16] dark:border-[#2C2A24]">
        <header className="px-5 py-4 border-b border-sand-border flex items-start justify-between gap-3 dark:border-[#2C2A24]">
          <div>
            <h2 className="text-base font-extrabold text-ink dark:text-[#F0ECE4]">
              {channel === 'whatsapp' ? '💬 Envoyer un WhatsApp' : '📱 Envoyer un SMS'}
            </h2>
            <p className="text-[11px] text-ink-muted mt-0.5 dark:text-[#C8C2B8]">
              Pour <strong>{recipientName}</strong> · <span className="font-mono">{recipientPhone}</span>
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Fermer"
            className="bg-sand-mid w-8 h-8 rounded-md text-ink-mid hover:bg-sand-border dark:bg-[rgba(255,255,255,.06)] dark:text-[#C8C2B8]"
          >
            ✕
          </button>
        </header>

        <div className="p-5 space-y-3 overflow-y-auto">
          {/* Toggle SMS / WhatsApp */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setChannel('sms')}
              className={
                'px-3 py-2 rounded-lg text-[12px] font-bold border-2 ' +
                (channel === 'sms'
                  ? 'bg-navy text-white border-navy'
                  : 'bg-white text-ink border-sand-border hover:border-navy-mid dark:bg-[#221E1A] dark:text-[#F0ECE4] dark:border-[#3D3A32]')
              }
            >
              📱 SMS
            </button>
            <button
              type="button"
              onClick={() => setChannel('whatsapp')}
              className={
                'px-3 py-2 rounded-lg text-[12px] font-bold border-2 ' +
                (channel === 'whatsapp'
                  ? 'bg-[#1F6B45] text-white border-[#1F6B45]'
                  : 'bg-white text-ink border-sand-border hover:border-[#1F6B45] dark:bg-[#221E1A] dark:text-[#F0ECE4] dark:border-[#3D3A32]')
              }
            >
              💬 WhatsApp
            </button>
          </div>

          <div>
            <label className="text-xs font-semibold text-ink-mid block mb-1.5 dark:text-[#C8C2B8]">
              Message
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={6}
              disabled={loadingPreview}
              placeholder={loadingPreview ? 'Chargement du template…' : 'Ton message…'}
              className="w-full px-3 py-2.5 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid resize-y dark:bg-[#221E1A] dark:border-[#3D3A32] dark:text-[#F0ECE4]"
            />
            <div className="flex justify-between text-[11px] text-ink-muted mt-1.5 dark:text-[#C8C2B8]">
              <span>
                {message.length} caractère(s) · {cost.segments} SMS{cost.segments > 1 ? 's' : ''}
              </span>
              <span>~ {cost.eur.toFixed(2).replace('.', ',')} €</span>
            </div>
            {defaultMessage && message !== defaultMessage && (
              <button
                type="button"
                onClick={() => setMessage(defaultMessage)}
                className="text-[11px] text-navy underline hover:no-underline mt-1 dark:text-[#A8C4F2]"
              >
                ↺ Réinitialiser le message
              </button>
            )}
          </div>

          {feedback && (
            <div
              className={
                'text-[12px] rounded-md px-3 py-2 border font-semibold ' +
                (feedback.kind === 'ok'
                  ? 'bg-ok-light border-ok-mid text-ok dark:bg-[#1F6B45] dark:text-white dark:border-[#2A8A5A]'
                  : 'bg-terra-light border-terra-mid text-terra')
              }
            >
              {feedback.msg}
            </div>
          )}
        </div>

        <footer className="px-5 py-3 border-t border-sand-border flex justify-end gap-2 dark:border-[#2C2A24]">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="bg-sand-mid text-ink-mid px-3.5 py-2 rounded-lg text-[12px] font-semibold disabled:opacity-50 dark:bg-[rgba(255,255,255,.06)] dark:text-[#C8C2B8]"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={handleSend}
            disabled={pending || !message.trim() || !recipientPhone}
            className="bg-navy text-white px-4 py-2 rounded-lg text-[12px] font-bold hover:opacity-90 disabled:opacity-50"
          >
            {pending ? 'Envoi…' : 'Envoyer ✓'}
          </button>
        </footer>
      </div>
    </div>
  );
}
