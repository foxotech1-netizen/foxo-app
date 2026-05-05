import { createClient } from '@/lib/supabase/server';
import type { Organisation } from '@/lib/types/database';
import { SyndicsClient } from '../syndics/SyndicsClient';

export const dynamic = 'force-dynamic';

// Réutilise SyndicsClient — il rend la liste de toutes les organisations
// passées en prop sans présupposer leur type. Le filtre se fait ici.
export default async function CourtiersPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('organisations')
    .select('*')
    .in('type', ['courtier', 'assurance'])
    .order('nom', { ascending: true });

  return (
    <SyndicsClient
      initial={(data ?? []) as Organisation[]}
      loadError={error?.message ?? null}
      title="Courtiers & Assurances"
    />
  );
}
