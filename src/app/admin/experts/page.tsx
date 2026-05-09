import { Search, Plus } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import type { Organisation } from '@/lib/types/database';
import { SyndicsClient } from '../syndics/SyndicsClient';

export const dynamic = 'force-dynamic';

export default async function ExpertsPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('organisations')
    .select('*')
    .eq('type', 'expert')
    .order('nom', { ascending: true });

  const experts = (data ?? []) as Organisation[];

  // Empty state explicite plutôt que la liste vide de SyndicsClient
  // (barre de filtres + tableau vide), peu informative pour ce cas.
  if (!error && experts.length === 0) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="mb-6 pb-3.5 border-b border-[var(--color-sand-border)]">
          <h1 className="fxs-page-title mb-1 inline-flex items-center gap-2">
            <Search size={20} className="text-[var(--color-navy)]" aria-hidden />
            Experts
          </h1>
          <div className="flex items-center gap-2 text-[11px] text-[var(--color-ink-mid)] tracking-wide">
            <span className="w-1 h-1 rounded-full bg-[var(--color-navy)]"></span>
            Aucun expert enregistré pour l&apos;instant
          </div>
        </div>
        <p className="text-[13px] text-[var(--color-ink-mid)] inline-flex flex-wrap items-center gap-1">
          <span>Crée un expert depuis la page Syndics (bouton «</span>
          <Plus size={12} />
          <span>Nouvelle organisation ») en sélectionnant le type « Expert » — il apparaîtra ici.</span>
        </p>
      </div>
    );
  }

  return (
    <SyndicsClient
      initial={experts}
      loadError={error?.message ?? null}
      title="Experts"
    />
  );
}
