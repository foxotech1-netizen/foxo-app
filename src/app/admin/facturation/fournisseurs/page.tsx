import { createClient } from '@/lib/supabase/server';
import type { Fournisseur } from '@/lib/types/database';
import { FournisseursClient } from './FournisseursClient';

export const dynamic = 'force-dynamic';

export default async function FournisseursPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('fournisseurs')
    .select('*')
    .is('deleted_at', null)
    .order('nom', { ascending: true });

  return (
    <>
      <div className="flex justify-between items-end mb-6 pb-3.5 border-b border-[var(--color-sand-border)]">
        <div>
          <h1 className="fxs-page-title mb-1">Fournisseurs</h1>
          <div className="flex items-center gap-2 text-[11px] text-[var(--color-ink-mid)] tracking-wide">
            <span className="w-1 h-1 rounded-full bg-[var(--color-navy)]"></span>
            Fiches fournisseurs du module achats
          </div>
        </div>
      </div>
      {error ? (
        <div className="text-[13px] text-terra bg-terra-light border border-terra-mid rounded-xl px-4 py-3">
          Erreur de chargement des fournisseurs : {error.message}
        </div>
      ) : (
        <FournisseursClient initial={(data ?? []) as Fournisseur[]} />
      )}
    </>
  );
}
