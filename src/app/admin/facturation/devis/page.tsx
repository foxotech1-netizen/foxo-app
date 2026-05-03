import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import type { Facture } from '@/lib/types/database';
import { DevisListClient } from './DevisListClient';

export const dynamic = 'force-dynamic';

export default async function DevisPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('factures')
    .select('*')
    .eq('type', 'devis')
    .is('deleted_at', null)
    .order('date_emission', { ascending: false, nullsFirst: false })
    .order('numero', { ascending: false })
    .limit(500);
  const devis = (data ?? []) as Facture[];

  return (
    <>
      <header className="px-6 py-4 flex flex-wrap items-center justify-between gap-3 bg-sand border-b border-sand-border flex-shrink-0">
        <div>
          <h1 className="text-xl font-extrabold text-ink">Devis</h1>
          <p className="text-[11px] text-ink-muted mt-0.5">
            {devis.length} devis chargé(s)
          </p>
        </div>
        <Link
          href="/admin/facturation/devis/new"
          className="bg-navy text-white px-3.5 py-2 rounded-lg text-xs font-bold hover:opacity-90"
        >
          + Nouveau devis
        </Link>
      </header>
      {error && (
        <div className="mx-6 mt-3 px-4 py-2.5 bg-amber-light border border-[#E8C896] text-[#8A5A1A] rounded-lg text-xs font-semibold flex-shrink-0">
          Erreur de chargement : {error.message}
        </div>
      )}
      <div className="flex-1 overflow-auto px-6 py-5">
        <DevisListClient initial={devis} />
      </div>
    </>
  );
}
