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
    .is('deleted_at', null)
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
      <div className="flex flex-wrap items-end justify-between gap-3 mb-6 pb-3.5 border-b border-[var(--color-sand-border)]">
        <div>
          <h1 className="fxs-page-title mb-1">
            Notes de crédit
          </h1>
          <div className="flex items-center gap-2 text-[11px] text-[var(--color-ink-mid)] tracking-wide">
            <span className="w-1 h-1 rounded-full bg-[var(--color-navy)]"></span>
            {avoirs.length} avoir{avoirs.length > 1 ? 's' : ''} — créés depuis une facture existante
          </div>
        </div>
        <p className="text-[11px] text-[var(--color-ink-muted)] italic">
          Crée un avoir depuis la fiche d&apos;une facture (bouton &laquo;&nbsp;Créer un avoir&nbsp;&raquo;).
        </p>
      </div>
      {error && (
        <div className="mb-3 px-4 py-2.5 bg-[var(--color-amber-light)] border border-[var(--color-amber-foxo)]/30 text-[var(--color-amber-foxo)] rounded-lg text-xs font-semibold">
          Erreur de chargement : {error.message}
        </div>
      )}
      <div>
        <NotesCreditListClient initial={avoirs} origineMap={Object.fromEntries(origineMap)} />
      </div>
    </>
  );
}
