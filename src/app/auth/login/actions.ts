'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { pathForRole } from '@/lib/auth/roles';
import { roleForUserId } from "@/lib/auth/server";

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

  // Whitelist applicative — bloque les signups sauvages, indépendamment du
  // toggle Supabase « Allow new users to sign up » (qu'on peut donc laisser
  // activé). Deux sources d'autorité, dans l'ordre (la whitelist d'emails
  // hardcodée TECH_EMAILS a été supprimée : les techniciens vivent désormais
  // dans utilisateurs avec role='technicien' et passent par le gate DB) :
  //   1. Table public.utilisateurs filtrée sur actif=true (techniciens + autres
  //      comptes internes). Soft delete via « Désactiver » d'/admin/techniciens
  //      → bloqué au login.
  //   2. Table public.delegues filtrée sur actif=true — partenaire désactivé =
  //      bloqué au login (toggle dans le drawer syndic).
  // shouldCreateUser reste à true : la whitelist DB est le seul gate.
  {
    const admin = createAdminClient();
    // 1. utilisateurs (techniciens et autres comptes internes)
    const { data: u } = await admin
      .from('utilisateurs')
      .select('email')
      .eq('email', email)
      .eq('actif', true)
      .maybeSingle();
    if (!u) {
      // 2. delegues (partenaires syndic/courtier)
      const { data: d } = await admin
        .from('delegues')
        .select('email')
        .eq('email', email)
        .eq('actif', true)
        .limit(1)
        .maybeSingle();
      if (!d) {
        return { error: 'Accès non autorisé. Contactez info@foxo.be.' };
      }
    }
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
  const { data, error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
  if (error) {
    console.warn('[auth/verifyOtp] failed for', email, ':', {
      message: error.message,
      status: error.status,
      code: (error as { code?: string }).code,
    });
    return { error: 'Code incorrect ou expiré.', sentTo: email };
  }

  // Routage selon rôle. En prod, le proxy rewrite admin.foxo.be → /admin etc.
  const role = data.user ? await roleForUserId(data.user.id) : 'partner';
  redirect(role ? pathForRole(role) : '/portal');
}
