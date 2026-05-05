import { createClient } from '@/lib/supabase/server';
import { ORGANISATION_TYPES_METIERS, type Organisation } from '@/lib/types/database';
import { SyndicsClient } from '../syndics/SyndicsClient';

export const dynamic = 'force-dynamic';

// Métiers = corps de métier sous-traitants (entrepreneur, plombier,
// électricien, toiturier, chauffagiste, autre_metier) sollicités sur
// intervention. Distincts des partenaires commerciaux (syndic / courtier
// / assurance / expert) qui ont leurs propres pages.
export default async function MetiersPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('organisations')
    .select('*')
    .in('type', ORGANISATION_TYPES_METIERS)
    .order('nom', { ascending: true });

  return (
    <SyndicsClient
      initial={(data ?? []) as Organisation[]}
      loadError={error?.message ?? null}
      title="Métiers & Entrepreneurs"
    />
  );
}
