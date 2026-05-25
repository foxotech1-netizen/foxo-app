import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { pathForRole } from '@/lib/auth/roles';
import { roleForUser } from "@/lib/auth/server";
import { Logo } from '@/components/Logo';
import { LoginForm } from './LoginForm';

// Label adaptatif selon le sous-domaine et le path d'origine (`next`).
// La page est physiquement la même pour les 3 apps — le proxy ne réécrit
// pas /auth/login (KNOWN_GROUP_PATHS). Sur portal.foxo.be / auth.foxo.be,
// le `next` query param permet de distinguer syndic / courtier / expert.
function labelForContext(host: string, next?: string): string {
  const h = host.toLowerCase().split(':')[0];
  if (h.startsWith('admin.')) return 'Interface Admin';
  if (h.startsWith('tech.'))  return 'App Technicien';
  if (h.startsWith('portal.') || h.startsWith('auth.')) {
    if (next?.includes('/courtier')) return 'Portail Courtier';
    if (next?.includes('/expert'))   return 'Portail Expert';
    if (next?.includes('/portal'))   return 'Portail Syndic';
    return 'Portail Partenaires';
  }
  return 'Connexion';
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    const role = await roleForUser();
    redirect(role ? pathForRole(role) : '/portal');
  }

  const hdrs = await headers();
  const host = hdrs.get('host') ?? '';
  const sp = await searchParams;
  const label = labelForContext(host, sp.next);

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{
        background: 'var(--color-sand)',
        // Radial gradients FoxO standards (cf. /rdv et MainContent) —
        // sky-foxo très subtil top-left, terra-mid encore plus subtil
        // bottom-right. Donne de la profondeur sans casser la lisibilité.
        backgroundImage:
          'radial-gradient(circle at 12% -5%, rgba(168, 212, 232, 0.18) 0%, transparent 45%), radial-gradient(circle at 95% 100%, rgba(196, 98, 45, 0.05) 0%, transparent 45%)',
      }}
    >
      <div
        className="w-full max-w-[420px] rounded-2xl overflow-hidden"
        style={{
          background: 'var(--color-cream)',
          // Triple shadow stack signature FoxO
          boxShadow:
            '0 1px 2px rgba(15, 32, 64, 0.04), 0 12px 32px rgba(15, 32, 64, 0.10), 0 0 0 1px rgba(15, 32, 64, 0.06)',
        }}
      >
        {/* Bannière logo + label de contexte */}
        <div
          className="py-7 px-5 flex flex-col items-center gap-2 border-b"
          style={{ borderColor: 'var(--color-sand-mid)' }}
        >
          <Logo size={84} variant="noir" priority />
          <div
            className="font-sora text-[11px] uppercase tracking-[0.12em] font-medium text-center"
            style={{ color: 'var(--color-ink-mid)' }}
          >
            {label}
          </div>
        </div>

        {/* Formulaire */}
        <div className="p-6 sm:p-8">
          <LoginForm />
        </div>
      </div>
    </div>
  );
}
