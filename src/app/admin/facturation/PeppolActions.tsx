'use client';

// Actions Peppol partagées entre le détail facture et le détail note de
// crédit : téléchargement de l'UBL (XML), envoi via Storecove, et badge du
// statut Peppol. `peppolEnabled` est calculé côté serveur
// (isStorecoveEnabled) — jamais de secret exposé ici.

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { FileCode2, Send } from 'lucide-react';
import { sendFactureViaPeppol } from './actions';
import type { Facture } from '@/lib/types/database';

export function PeppolActions({
  facture,
  peppolEnabled,
}: {
  facture: Facture;
  peppolEnabled: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // « Émise » = plus un brouillon et numéro définitif attribué.
  const emitted = facture.statut !== 'brouillon' && !facture.numero.startsWith('BR-');
  const annulee = facture.statut === 'annulee';

  const btnBase =
    'px-3 py-2 rounded-lg text-[12px] font-bold min-h-[44px] inline-flex items-center gap-1.5';

  function handleSendPeppol() {
    if (!confirm(`Envoyer ${facture.numero} via le réseau Peppol ?\n\nLe document UBL sera transmis au point d'accès Storecove et routé vers le n° BCE du client.`)) {
      return;
    }
    startTransition(async () => {
      const res = await sendFactureViaPeppol(facture.id);
      if (!res.ok) {
        alert(res.error);
      } else {
        alert('Document transmis via Peppol.');
      }
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2">
      {emitted ? (
        <a
          href={`/api/admin/facture/${facture.id}/ubl`}
          className={`${btnBase} bg-white text-navy border border-navy-light hover:bg-navy-pale`}
        >
          <FileCode2 size={14} aria-hidden /> Télécharger UBL (XML)
        </a>
      ) : (
        <button
          type="button"
          disabled
          title="Disponible après émission (le brouillon n'a pas encore de numéro définitif)."
          className={`${btnBase} bg-sand-mid text-ink-muted border border-sand-border cursor-not-allowed`}
        >
          <FileCode2 size={14} aria-hidden /> Télécharger UBL (XML)
        </button>
      )}

      {peppolEnabled && emitted && !annulee ? (
        <button
          type="button"
          onClick={handleSendPeppol}
          disabled={pending}
          className={`${btnBase} bg-navy text-white hover:opacity-90 disabled:opacity-50`}
        >
          <Send size={14} aria-hidden /> {pending ? 'Envoi…' : 'Envoyer via Peppol'}
        </button>
      ) : (
        <button
          type="button"
          disabled
          title={
            !peppolEnabled
              ? 'Peppol non activé — configurez Storecove dans Paramètres (clés serveur + interrupteur).'
              : annulee
                ? 'Document annulé — envoi Peppol refusé.'
                : 'Disponible après émission du document.'
          }
          className={`${btnBase} bg-sand-mid text-ink-muted border border-sand-border cursor-not-allowed`}
        >
          <Send size={14} aria-hidden /> Envoyer via Peppol
        </button>
      )}

      {facture.peppol_status === 'envoyee' && (
        <span
          className="text-[11px] font-bold px-2 py-1 rounded-md bg-ok-light border border-ok-mid text-ok"
          title={facture.peppol_sent_at ? `Transmis le ${new Date(facture.peppol_sent_at).toLocaleString('fr-BE')}` : undefined}
        >
          Peppol : envoyée
        </span>
      )}
      {facture.peppol_status === 'erreur' && (
        <span className="inline-flex flex-col gap-0.5 max-w-[260px]">
          <span className="text-[11px] font-bold px-2 py-1 rounded-md bg-terra-light border border-terra-mid text-terra self-start">
            Peppol : erreur
          </span>
          {facture.peppol_last_error && (
            <span className="text-[10px] text-ink-muted leading-snug" title={facture.peppol_last_error}>
              {facture.peppol_last_error.length > 120
                ? `${facture.peppol_last_error.slice(0, 120)}…`
                : facture.peppol_last_error}
            </span>
          )}
        </span>
      )}
    </div>
  );
}
