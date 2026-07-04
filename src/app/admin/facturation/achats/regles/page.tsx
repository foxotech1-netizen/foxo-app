import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import type { RegleMapping } from '@/lib/types/database';
import { ReglesClient } from './ReglesClient';

export const dynamic = 'force-dynamic';

export default async function ReglesMappingPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('regles_mapping')
    .select('*')
    .order('priorite', { ascending: true })
    .order('created_at', { ascending: false });

  return (
    <>
      <div className="flex flex-wrap justify-between items-end gap-3 mb-6 pb-3.5 border-b border-[var(--color-sand-border)]">
        <div>
          <h1 className="fxs-page-title mb-1">Règles de mapping</h1>
          <div className="flex items-center gap-2 text-[11px] text-[var(--color-ink-mid)] tracking-wide">
            <span className="w-1 h-1 rounded-full bg-[var(--color-navy)]"></span>
            Enseigne → catégorie comptable + déductibilité (pré-remplissage des achats)
          </div>
        </div>
        <Link
          href="/admin/facturation/achats"
          className="text-[12px] text-[var(--color-ink-mid)] hover:text-[var(--color-navy)] min-h-[44px] inline-flex items-center"
        >
          ← Retour aux achats
        </Link>
      </div>
      {error ? (
        <div className="text-[13px] text-terra bg-terra-light border border-terra-mid rounded-xl px-4 py-3">
          Erreur de chargement des règles : {error.message}
        </div>
      ) : (
        <ReglesClient initial={(data ?? []) as RegleMapping[]} />
      )}
    </>
  );
}
