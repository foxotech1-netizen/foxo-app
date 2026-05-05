'use server';

import { createClient } from '@/lib/supabase/server';
import type { ThemeKey } from '@/lib/themes';

export type ThemeActionResult<T = void> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

const ALLOWED: ThemeKey[] = ['dark-amber', 'warm-light', 'foxo-blue'];

function isThemeKey(s: unknown): s is ThemeKey {
  return typeof s === 'string' && (ALLOWED as string[]).includes(s);
}

// Lit la préférence de thème de l'utilisateur connecté. Retourne null
// si pas de préférence stockée (le client retombe alors sur localStorage
// puis sur le défaut du portail). Pas de gate role : tout user authentifié
// peut lire/écrire SA préférence (cf. RLS self_*).
export async function getUserTheme(): Promise<ThemeActionResult<ThemeKey | null>> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Non authentifié.' };

  const { data, error } = await supabase
    .from('user_preferences')
    .select('theme')
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) {
    // Table absente (migration non appliquée) → on dégrade silencieusement
    // côté client en retombant sur localStorage.
    return { ok: false, error: error.message };
  }
  const theme = isThemeKey(data?.theme) ? data!.theme as ThemeKey : null;
  return { ok: true, data: theme };
}

// Upsert la préférence de thème. Validation côté serveur (la liste
// ALLOWED) en plus du CHECK SQL.
export async function saveUserTheme(theme: ThemeKey): Promise<ThemeActionResult> {
  if (!isThemeKey(theme)) return { ok: false, error: 'Thème invalide.' };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Non authentifié.' };

  const { error } = await supabase
    .from('user_preferences')
    .upsert(
      { user_id: user.id, theme, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
