import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { pathForRole } from '@/lib/auth/roles';
import { roleForUser } from "@/lib/auth/server";

// Page racine : non utilisée en prod (les sous-domaines sont rewritten par
// le proxy). En dev/local, redirige vers le login ou vers l'app du rôle.
export default async function Root() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/auth/login');
  const role = await roleForUser();
  redirect(role ? pathForRole(role) : '/portal');
}
