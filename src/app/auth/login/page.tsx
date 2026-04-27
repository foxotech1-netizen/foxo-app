import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { roleForEmail, pathForRole } from '@/lib/auth/roles';
import { Logo } from '@/components/Logo';
import { LoginForm } from './LoginForm';

export default async function LoginPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    const role = roleForEmail(user.email);
    redirect(role ? pathForRole(role) : '/portal');
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-sand p-4">
      <div className="w-full max-w-[400px] bg-cream rounded-2xl border border-sand-border shadow-xl overflow-hidden">
        {/* Bannière logo */}
        <div className="bg-[#E2C9A1] py-7 flex flex-col items-center gap-2 border-b border-[rgba(0,0,0,0.12)]">
          <Logo size={84} variant="black" priority />
          <div className="text-[10px] text-[#7A6A50] uppercase tracking-[.15em] font-semibold">
            Connexion
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
