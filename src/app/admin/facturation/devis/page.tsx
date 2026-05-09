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
      <div className="flex flex-wrap items-end justify-between gap-3 mb-6 pb-3.5 border-b border-[var(--color-sand-border)]">
        <div>
          <h1 className="fxs-page-title mb-1">
            De<span>vis</span>
          </h1>
          <div className="flex items-center gap-2 text-[11px] text-[var(--color-ink-mid)] tracking-wide">
            <span className="w-1 h-1 rounded-full bg-[var(--color-navy)]"></span>
            {devis.length} devis chargé{devis.length > 1 ? 's' : ''}
          </div>
        </div>
        <Link
          href="/admin/facturation/devis/new"
          className="bg-[var(--color-navy)] hover:bg-[var(--color-navy-dark)] text-[var(--color-cream)] px-3.5 py-2 rounded-md text-xs font-medium shadow-sm"
        >
          + Nouveau devis
        </Link>
      </div>
      {error && (
        <div className="mb-3 px-4 py-2.5 bg-[var(--color-amber-light)] border border-[var(--color-amber-foxo)]/30 text-[var(--color-amber-foxo)] rounded-lg text-xs font-semibold">
          Erreur de chargement : {error.message}
        </div>
      )}
      <div>
        <DevisListClient initial={devis} />
      </div>
    </>
  );
}
