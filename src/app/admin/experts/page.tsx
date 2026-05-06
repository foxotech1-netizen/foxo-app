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
      <div className="max-w-2xl mx-auto p-6">
        <h1 className="text-xl font-extrabold text-ink dark:text-[#F0ECE4] mb-2 inline-flex items-center gap-2">
          <Search size={18} />
          <span>Experts</span>
        </h1>
        <p className="text-[13px] text-ink-mid dark:text-[#C8C2B8] inline-flex flex-wrap items-center gap-1">
          <span>Aucun expert enregistré. Crée un expert depuis la page Syndics (bouton «</span>
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
