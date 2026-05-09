import { createClient } from '@/lib/supabase/server';
import type { Client } from '@/lib/types/database';
import { ClientsListClient } from './ClientsListClient';

export const dynamic = 'force-dynamic';

export default async function ClientsPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .order('nom', { ascending: true });
  const clients = (data ?? []) as Client[];

  return (
    <>
      <div className="mb-6 pb-3.5 border-b border-[var(--color-sand-border)]">
        <h1 className="fxs-page-title mb-1">
          <span>Clients</span>
        </h1>
        <div className="flex items-center gap-2 text-[11px] text-[var(--color-ink-mid)] tracking-wide">
          <span className="w-1 h-1 rounded-full bg-[var(--color-navy)]"></span>
          {clients.length} client{clients.length > 1 ? 's' : ''} — ACP, particuliers, entreprises
        </div>
      </div>

      {error && (
        <div className="mb-3 px-4 py-2.5 bg-[var(--color-amber-light)] border border-[var(--color-amber-foxo)]/30 text-[var(--color-amber-foxo)] rounded-lg text-xs font-semibold">
          Erreur : {error.message}
        </div>
      )}

      <div>
        <ClientsListClient initial={clients} />
      </div>
    </>
  );
}
