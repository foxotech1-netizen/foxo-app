'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { roleForEmail, pathForRole } from '@/lib/auth/roles';

export type AuthState = { error?: string; sentTo?: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OTP_RE = /^\d{6}$/;

// Quelques erreurs Supabase courantes traduites en français.
function translateAuthError(rawMsg: string): string {
  const m = rawMsg.toLowerCase();
  if (m.includes('rate limit') || m.includes('too many')) {
    return 'Trop de tentatives — réessayez dans quelques minutes.';
  }
  if (m.includes('signup') && m.includes('disabled')) {
    return 'L\'inscription est désactivée pour cette adresse.';
  }
  if (m.includes('signups not allowed')) {
    return 'Adresse non autorisée pour l\'inscription.';
  }
  if (m.includes('email rate limit')) {
    return 'Trop de mails envoyés — patientez quelques minutes.';
  }
  if (m.includes('email not confirmed')) {
    return 'Email non confirmé.';
  }
  if (m.includes('invalid') && m.includes('email')) {
    return 'Adresse email invalide.';
  }
  return rawMsg;
}

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
    // Logue l'erreur brute côté serveur pour diagnostic (Vercel logs)
    console.warn('[auth/sendOtp] failed for', email, ':', {
      message: error.message,
      status: error.status,
      code: (error as { code?: string }).code,
    });
    const msg = translateAuthError(error.message ?? 'erreur inconnue');
    return { error: `Envoi impossible : ${msg}` };
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
    console.warn('[auth/verifyOtp] failed for', email, ':', {
      message: error.message,
      status: error.status,
      code: (error as { code?: string }).code,
    });
    return { error: 'Code incorrect ou expiré.', sentTo: email };
  }

  // Routage selon rôle. En prod, le proxy rewrite admin.foxo.be → /admin etc.
  const role = roleForEmail(email);
  redirect(role ? pathForRole(role) : '/portal');
}
