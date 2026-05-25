import { createClient } from '@/lib/supabase/server';
import { isAdminUser } from "@/lib/auth/server";

// Throw si l'utilisateur courant n'est pas admin (déléguée à isAdminUser(),
// qui lit utilisateurs.role). Les server actions qui l'appellent doivent
// laisser l'erreur remonter au client — Next sérialise le throw en
// erreur serveur côté React.
//
// Pour un retour structuré { ok: false, error } (utilisé par certaines
// routes/actions historiques), faire le check inline plutôt que d'appeler
// cette fonction.
export async function assertAdmin(): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await isAdminUser())) {
    throw new Error('Accès refusé.');
  }
}
