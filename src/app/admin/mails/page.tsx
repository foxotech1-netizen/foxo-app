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
      <header className="px-6 py-4 flex flex-wrap items-center justify-between gap-3 bg-sand border-b border-sand-border flex-shrink-0">
        <div>
          <h1 className="text-xl font-extrabold text-ink">Mails</h1>
          <p className="text-[11px] text-ink-muted mt-0.5">
            {connected ? <>Boîte connectée : <span className="font-mono">{accountEmail ?? 'compte Google'}</span></> : 'Boîte non connectée'}
          </p>
        </div>
      </header>

      {!connected && (
        <div className="mx-6 mt-3 px-4 py-3 bg-amber-light border border-[#E8C896] rounded-lg text-[13px] text-[#8A5A1A] flex items-center justify-between gap-3 flex-shrink-0">
          <span className="inline-flex items-center gap-1.5">
            <AlertTriangle size={14} aria-hidden /> Connectez votre compte Google dans{' '}
            <Link href="/admin/parametres" className="underline font-bold">Paramètres → Intégrations Google</Link>
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
