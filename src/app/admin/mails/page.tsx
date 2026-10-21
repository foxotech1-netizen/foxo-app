import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { loadTokens } from '@/lib/google-auth';
import { MailsClient } from './MailsClient';

export const dynamic = 'force-dynamic';

export default async function MailsPage() {
  // Vérifie côté serveur si Google est connecté pour afficher le bandeau
  const tokens = await loadTokens();
  const connected = Boolean(tokens?.access_token && tokens?.refresh_token);
  const accountEmail = tokens?.email ?? null;

  return (
    <>
      <div className="mb-6 pb-3.5 border-b border-[var(--color-sand-border)]">
        <h1 className="fxs-page-title mb-1">
          Mails
        </h1>
        <div className="fx-small flex items-center gap-2 text-[var(--color-ink-mid)] tracking-wide">
          <span className="w-1 h-1 rounded-full bg-[var(--color-navy)]"></span>
          {connected ? <>Boîte connectée : <span className="tabular-nums">{accountEmail ?? 'compte Google'}</span></> : 'Boîte non connectée'}
        </div>
      </div>

      {!connected && (
        <div className="fx-body mx-6 mt-3 px-4 py-3 bg-amber-light border border-[var(--color-amber-foxo)]/30 rounded-lg text-amber-ink flex items-center justify-between gap-3 flex-shrink-0">
          <span className="inline-flex items-center gap-1.5">
            <AlertTriangle size={14} aria-hidden /> Connectez votre compte Google dans{' '}
            <Link href="/admin/parametres" className="underline font-semibold">Paramètres → Intégrations Google</Link>
            {' '}pour afficher la boîte mail.
          </span>
        </div>
      )}

      <div className="flex-1 overflow-hidden">
        <MailsClient initialConnected={connected} />
      </div>
    </>
  );
}
