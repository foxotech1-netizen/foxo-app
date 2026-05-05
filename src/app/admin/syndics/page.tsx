import { createClient } from '@/lib/supabase/server';
import type { Organisation } from '@/lib/types/database';
import { SyndicsClient } from './SyndicsClient';

export const dynamic = 'force-dynamic';

export default async function SyndicsPage() {
  const supabase = await createClient();
  // Filtre type='syndic' uniquement — les autres types (courtier,
  // assurance, expert, métiers) ont leur page dédiée dans le menu
  // Partenaires de la sidebar.
  const { data, error } = await supabase
    .from('organisations')
    .select('*')
    .eq('type', 'syndic')
    .order('nom', { ascending: true });

  return (
    <SyndicsClient
      initial={(data ?? []) as Organisation[]}
      loadError={error?.message ?? null}
      title="Syndics"
    />
  );
}
