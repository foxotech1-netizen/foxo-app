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
      <header className="px-6 py-4 bg-sand border-b border-sand-border flex-shrink-0">
        <h1 className="text-xl font-extrabold text-ink">Clients</h1>
        <p className="text-[11px] text-ink-muted mt-0.5">
          {clients.length} client(s) — ACP, particuliers, entreprises
        </p>
      </header>

      {error && (
        <div className="mx-6 mt-3 px-4 py-2.5 bg-amber-light border border-[#E8C896] text-[#8A5A1A] rounded-lg text-xs font-semibold flex-shrink-0">
          Erreur : {error.message}
        </div>
      )}

      <div className="flex-1 overflow-auto px-6 py-5">
        <ClientsListClient initial={clients} />
      </div>
    </>
  );
}
