import { createClient } from '@/lib/supabase/server';
import type { Organisation } from '@/lib/types/database';

// Récupère l'organisation (syndic ou courtier) liée à l'utilisateur connecté.
// Retourne null si l'email n'est pas mappé. Dans ce cas, le portail doit
// afficher un message clair et NE PAS retourner toutes les interventions.
export async function getCurrentSyndic(): Promise<{
  user: { email: string | null };
  org: Organisation | null;
} | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const email = (user.email ?? '').toLowerCase();
  const { data: org } = await supabase
    .from('organisations')
    .select('*')
    .eq('email', email)
    .maybeSingle();

  return { user: { email: user.email ?? null }, org: (org as Organisation | null) ?? null };
}
