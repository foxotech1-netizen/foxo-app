import { createClient } from '@supabase/supabase-js';

// Client service-role — usage strictement serveur (Server Actions, Route Handlers).
// NE JAMAIS exposer côté client. Lance une erreur si la clé n'est pas configurée
// pour qu'un appel non intentionnel échoue tôt.
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY manquante. Configure-la dans .env.local pour utiliser createAdminClient().',
    );
  }
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
