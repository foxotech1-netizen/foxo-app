import { createClient } from '@/lib/supabase/server';
import { roleForEmail } from '@/lib/auth/roles';

// Throw si l'utilisateur courant n'est pas admin (whitelist hardcodée
// ADMIN_EMAILS de roles.ts). Les server actions qui l'appellent doivent
// laisser l'erreur remonter au client — Next sérialise le throw en
// erreur serveur côté React.
//
// Pour un retour structuré { ok: false, error } (utilisé par certaines
// routes/actions historiques), faire le check inline plutôt que d'appeler
// cette fonction.
export async function assertAdmin(): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || roleForEmail(user.email) !== 'admin') {
    throw new Error('Accès refusé.');
  }
}
