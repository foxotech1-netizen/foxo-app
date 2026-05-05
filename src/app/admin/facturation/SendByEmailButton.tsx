'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Facture } from '@/lib/types/database';
import { sendDocumentEmail } from './actions';

export interface EmailDefaults {
  to: string;
  subject: string;
  intro: string;
}

// Bouton « 📧 Envoyer par email » placé dans le header de la fiche
// document (facture / devis / avoir). Au clic, ouvre une modale avec
// destinataire/sujet/message pré-remplis et éditables. À l'envoi,
// appelle la server action sendDocumentEmail qui rend le PDF, l'envoie
// via Gmail API et bascule le statut à 'envoyee' si brouillon.
//
// Reçoit `defaults` pré-calculés côté SSR (cf. lib/facturation/email-defaults)
// pour éviter un round-trip serveur à l'ouverture.
export function SendByEmailButton({
  facture,
  defaults,
}: {
  facture: Facture;
  defaults: EmailDefaults;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const [to, setTo] = useState(defaults.to);
  const [subject, setSubject] = useState(defaults.subject);
  const [message, setMessage] = useState('');
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  // Re-synchronise les champs si on rouvre la modale après une action
  // qui aurait changé la facture (ex : fix du destinataire dans la fiche
  // client puis revient ici). Pattern React 19 : storing prev props.
  const [lastDefaults, setLastDefaults] = useState(defaults);
  if (lastDefaults !== defaults) {
    setLastDefaults(defaults);
    setTo(defaults.to);
    setSubject(defaults.subject);
  }

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !pending) setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, pending]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    startTransition(async () => {
      const res = await sendDocumentEmail({
        id: facture.id,
        to,
        subject,
        message: message.trim() || undefined,
      });
      if (!res.ok) {
        setFeedback({ kind: 'err', msg: res.error });
        return;
      }
      setFeedback({
        kind: 'ok',
        msg: res.data?.statutChanged
          ? `Email envoyé. Document marqué « envoyé ».`
          : `Email envoyé.`,
      });
      // Reset message libre, garde sujet/destinataire (utile pour relance manuelle)
      setMessage('');
      router.refresh();
      // Auto-close après 1.5s pour laisser lire le feedback
      setTimeout(() => setOpen(false), 1500);
    });
  }

  // Désactive si annulée (server action refuse de toute façon, mais cohérence UI)
  const disabledReason = facture.statut === 'annulee'
    ? 'Document annulé : envoi désactivé.'
    : facture.deleted_at
      ? 'Document supprimé.'
      : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={Boolean(disabledReason)}
        title={disabledReason ?? 'Envoyer par email'}
        className="bg-ok text-white px-3 py-2 rounded-lg text-[12px] font-bold hover:opacity-90 min-h-[44px] inline-flex items-center disabled:opacity-50 disabled:cursor-not-allowed"
      >
        📧 Envoyer par email
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="send-email-dialog-title"
          className="fixed inset-0 z-[100] flex items-center justify-center px-4"
        >
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
            onClick={() => { if (!pending) setOpen(false); }}
          />
          <form
            onSubmit={handleSubmit}
            className="relative bg-cream rounded-xl border border-sand-border shadow-2xl w-full max-w-lg p-5"
          >
            <h2 id="send-email-dialog-title" className="text-base font-extrabold text-ink mb-1">
              Envoyer {labelForType(facture.type)} <span className="font-mono">{facture.numero}</span>
            </h2>
            <p className="text-[12px] text-ink-muted mb-4">
              Le PDF sera joint automatiquement. {facture.statut === 'brouillon' && 'Le statut passera à « envoyé ».'}
            </p>

            <div className="space-y-3">
              <Field label="Destinataire" htmlFor="email-to">
                <input
                  id="email-to"
                  type="email"
                  required
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  disabled={pending}
                  placeholder="contact@exemple.be"
                  className="w-full px-3 py-2 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid"
                />
              </Field>

              <Field label="Sujet" htmlFor="email-subject">
                <input
                  id="email-subject"
                  type="text"
                  required
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  disabled={pending}
                  className="w-full px-3 py-2 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid"
                />
              </Field>

              <Field label="Message libre (optionnel)" htmlFor="email-message">
                <textarea
                  id="email-message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  disabled={pending}
                  rows={4}
                  placeholder="Ajoute un mot personnel — le texte standard « Veuillez trouver ci-joint… » est déjà inclus dans le mail."
                  className="w-full px-3 py-2 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid resize-y"
                />
              </Field>
            </div>

            {feedback && (
              <div
                className={
                  'mt-3 px-3 py-2 text-xs rounded-md font-semibold ' +
                  (feedback.kind === 'ok'
                    ? 'bg-ok-light border border-ok-mid text-ok'
                    : 'bg-terra-light border border-terra-mid text-terra')
                }
              >
                {feedback.msg}
              </div>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={pending}
                className="px-3.5 py-2 rounded-lg text-xs font-bold border border-sand-border bg-cream text-ink-mid hover:bg-sand-mid disabled:opacity-50"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={pending}
                className="px-3.5 py-2 rounded-lg text-xs font-bold bg-ok text-white hover:opacity-90 disabled:opacity-50"
              >
                {pending ? 'Envoi…' : '📧 Envoyer'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-[10px] font-bold uppercase tracking-wider text-ink-muted mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}

function labelForType(type: Facture['type']): string {
  switch (type) {
    case 'devis': return 'le devis';
    case 'avoir': return 'la note de crédit';
    default:      return 'la facture';
  }
}
