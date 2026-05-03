import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import type { Facture } from '@/lib/types/database';
import { NotesCreditListClient } from './NotesCreditListClient';

export const dynamic = 'force-dynamic';

export default async function NotesCreditPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('factures')
    .select('*')
    .eq('type', 'avoir')
    .order('date_emission', { ascending: false, nullsFirst: false })
    .order('numero', { ascending: false })
    .limit(500);
  const avoirs = (data ?? []) as Facture[];

  // Charge la table de noms des factures d'origine pour affichage rapide.
  const origineIds = Array.from(new Set(avoirs.map((a) => a.facture_origine_id).filter(Boolean) as string[]));
  let origineMap = new Map<string, string>();
  if (origineIds.length > 0) {
    const { data: origines } = await supabase
      .from('factures')
      .select('id, numero')
      .in('id', origineIds);
    origineMap = new Map(((origines ?? []) as { id: string; numero: string }[]).map((o) => [o.id, o.numero]));
  }

  return (
    <>
      <header className="px-6 py-4 flex flex-wrap items-center justify-between gap-3 bg-sand border-b border-sand-border flex-shrink-0">
        <div>
          <h1 className="text-xl font-extrabold text-ink">Notes de crédit</h1>
          <p className="text-[11px] text-ink-muted mt-0.5">
            {avoirs.length} avoir(s) — créés depuis une facture existante
          </p>
        </div>
        <p className="text-[11px] text-ink-muted italic">
          Crée un avoir depuis la fiche d&apos;une facture (bouton &laquo;&nbsp;Créer un avoir&nbsp;&raquo;).
        </p>
      </header>
      {error && (
        <div className="mx-6 mt-3 px-4 py-2.5 bg-amber-light border border-[#E8C896] text-[#8A5A1A] rounded-lg text-xs font-semibold flex-shrink-0">
          Erreur de chargement : {error.message}
        </div>
      )}
      <div className="flex-1 overflow-auto px-6 py-5">
        <NotesCreditListClient initial={avoirs} origineMap={Object.fromEntries(origineMap)} />
      </div>
    </>
  );
}
