import { createAdminClient } from '@/lib/supabase/admin';

const WINDOW_MIN = 60;
const MAX_PER_WINDOW = 3;

export type RateLimitResult = { ok: true } | { ok: false; retryAfterMin: number };

export function getRequestIp(headers: Headers): string {
  // Vercel : x-forwarded-for est la liste des IPs proxy. Le client = première.
  const fwd = headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  const real = headers.get('x-real-ip');
  if (real) return real;
  return 'unknown';
}

// Vérifie qu'une IP n'a pas dépassé MAX_PER_WINDOW soumissions sur WINDOW_MIN
// dernières minutes. Persisté en BDD via service-role (table rdv_attempts
// invisible des clients anon).
export async function checkRdvRateLimit(ip: string): Promise<RateLimitResult> {
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    // Pas de service-role configuré — on désactive le rate limit (dev local).
    console.warn('[rate-limit] SUPABASE_SERVICE_ROLE_KEY absente, rate limit désactivé.');
    return { ok: true };
  }

  const since = new Date(Date.now() - WINDOW_MIN * 60_000).toISOString();
  const { count, error } = await admin
    .from('rdv_attempts')
    .select('*', { count: 'exact', head: true })
    .eq('ip', ip)
    .gte('created_at', since);

  if (error) {
    console.warn('[rate-limit] query error:', error.message);
    return { ok: true }; // fail-open : on ne bloque pas un user si la table déconne
  }

  if ((count ?? 0) >= MAX_PER_WINDOW) {
    return { ok: false, retryAfterMin: WINDOW_MIN };
  }
  return { ok: true };
}

export async function recordRdvAttempt(ip: string): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.from('rdv_attempts').insert({ ip });
  } catch {
    // Idem : si pas de service-role, on n'enregistre rien.
  }
}
