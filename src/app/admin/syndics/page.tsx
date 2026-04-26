import { createClient } from '@/lib/supabase/server';
import type { Organisation } from '@/lib/types/database';
import { SyndicsClient } from './SyndicsClient';

export const dynamic = 'force-dynamic';

export default async function SyndicsPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('organisations')
    .select('*')
    .order('nom', { ascending: true });

  return (
    <SyndicsClient
      initial={(data ?? []) as Organisation[]}
      loadError={error?.message ?? null}
    />
  );
}
