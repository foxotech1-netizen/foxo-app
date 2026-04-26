import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

// À utiliser dans Server Components / Server Actions / Route Handlers.
// Note Next 16 : `cookies()` est asynchrone.
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Server Component pur : impossible de set les cookies ici.
            // Le proxy.ts s'en charge — on peut ignorer.
          }
        },
      },
    },
  );
}
