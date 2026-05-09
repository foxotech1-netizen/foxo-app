import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { roleForEmail, pathForRole } from '@/lib/auth/roles';
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
    const role = roleForEmail(user.email);
    redirect(role ? pathForRole(role) : '/portal');
  }

  const hdrs = await headers();
  const host = hdrs.get('host') ?? '';
  const sp = await searchParams;
  const label = labelForContext(host, sp.next);

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: 'linear-gradient(180deg, #2C2A24 0%, #1A1814 100%)' }}
    >
      <div
        className="w-full max-w-[400px] rounded-2xl shadow-xl overflow-hidden"
        style={{ background: '#E2C9A1' }}
      >
        {/* Bannière logo */}
        <div className="py-7 flex flex-col items-center gap-2 border-b border-[rgba(0,0,0,0.12)]">
          <Logo size={84} variant="noir" priority />
          <div
            className="text-[10px] uppercase tracking-[.15em] font-semibold"
            style={{ color: '#7A6A50' }}
          >
            {label}
          </div>
        </div>

        {/* Formulaire */}
        <div className="p-7 sm:p-8">
          <LoginForm />
        </div>
      </div>
    </div>
  );
}
