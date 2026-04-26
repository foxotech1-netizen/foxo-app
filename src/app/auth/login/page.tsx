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
    <div className="min-h-screen flex items-center justify-center bg-[#080F1A] p-4">
      <div className="w-full max-w-[400px] bg-[#0F2040] rounded-2xl border border-[#1B3A6B] p-10 shadow-2xl">
        <div className="flex flex-col items-center mb-2">
          <Logo size={88} priority />
          <div className="text-[11px] text-[#5A7494] uppercase tracking-widest mt-3">
            Connexion
          </div>
        </div>
        <div className="h-px bg-white/10 my-6" />
        <LoginForm />
      </div>
    </div>
  );
}
