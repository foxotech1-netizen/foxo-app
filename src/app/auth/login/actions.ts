'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { roleForEmail, pathForRole } from '@/lib/auth/roles';

export type AuthState = { error?: string; sentTo?: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OTP_RE = /^\d{6}$/;

export async function sendOtp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return { error: 'Adresse email invalide.' };
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  });
  if (error) {
    return { error: 'Envoi du code impossible — réessaye dans un instant.' };
  }
  return { sentTo: email };
}

export async function verifyOtp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const token = String(formData.get('token') ?? '').trim();
  if (!EMAIL_RE.test(email)) return { error: 'Email invalide.', sentTo: email };
  if (!OTP_RE.test(token)) return { error: 'Code à 6 chiffres requis.', sentTo: email };

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
  if (error) {
    return { error: 'Code incorrect ou expiré.', sentTo: email };
  }

  // Routage selon rôle. En prod, le proxy rewrite admin.foxo.be → /admin etc.
  const role = roleForEmail(email);
  redirect(role ? pathForRole(role) : '/portal');
}
