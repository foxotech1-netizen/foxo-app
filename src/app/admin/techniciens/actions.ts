'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdminUser } from "@/lib/auth/server";
import type { ActionState } from '../actions';

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function assertAdmin(): Promise<ActionState | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await isAdminUser())) {
    return { error: 'Accès refusé.' };
  }
  return null;
}

export async function createTech(form: FormData): Promise<ActionState> {
  const guard = await assertAdmin();
  if (guard) return guard;

  const prenom = String(form.get('prenom') ?? '').trim();
  const nom = String(form.get('nom') ?? '').trim();
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const telephone = String(form.get('telephone') ?? '').trim() || null;
  const couleur = String(form.get('couleur') ?? '').trim() || '#1B3A6B';

  if (!prenom) return { error: 'Le prénom est obligatoire.' };
  if (!nom) return { error: 'Le nom est obligatoire.' };
  if (!email || !EMAIL_RE.test(email)) return { error: 'Email invalide.' };
  if (!HEX_RE.test(couleur)) return { error: 'Couleur invalide (format #RRGGBB attendu).' };

  // Client service-role : requis pour creer le compte d'authentification ET
  // inserer la ligne utilisateurs avec id = uuid auth (FK utilisateurs_id_fkey).
  const admin = createAdminClient();

  // 1) Resoudre / creer le compte de connexion (auth.users).
  const { data: usersData, error: usersErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (usersErr) {
    return { error: `Impossible de verifier les comptes existants : ${usersErr.message}` };
  }
  const existing = usersData?.users.find((u) => (u.email ?? '').toLowerCase() === email);

  let userId: string;
  if (existing) {
    userId = existing.id;
  } else {
    const { data: createdData, error: createErr } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
    });
    if (createErr || !createdData?.user) {
      return { error: `Impossible de creer le compte de connexion : ${createErr?.message ?? 'inconnu'}` };
    }
    userId = createdData.user.id;
  }

  // 2) Inserer le profil technicien avec id = uuid auth.
  const { data, error } = await admin
    .from('utilisateurs')
    .insert({
      id: userId,
      prenom,
      nom,
      email,
      telephone,
      couleur,
      role: 'technicien',
      actif: true,
    })
    .select()
    .single();

  if (error) {
    if ((error as { code?: string }).code === '23505') {
      return { error: 'Cet email est deja enregistre.' };
    }
    return { error: error.message };
  }

  revalidatePath('/admin/techniciens');
  return { ok: true, data };
}

export async function updateTech(id: string, form: FormData): Promise<ActionState> {
  const guard = await assertAdmin();
  if (guard) return guard;
  if (!id) return { error: 'ID manquant.' };

  const prenom = String(form.get('prenom') ?? '').trim();
  const nom = String(form.get('nom') ?? '').trim();
  const telephone = String(form.get('telephone') ?? '').trim() || null;
  const couleur = String(form.get('couleur') ?? '').trim() || '#1B3A6B';
  const actifRaw = form.get('actif');
  const actif = actifRaw === null ? undefined : actifRaw === 'true' || actifRaw === 'on';

  if (!prenom) return { error: 'Le prénom est obligatoire.' };
  if (!nom) return { error: 'Le nom est obligatoire.' };
  if (!HEX_RE.test(couleur)) return { error: 'Couleur invalide (format #RRGGBB attendu).' };

  const patch: Record<string, unknown> = { prenom, nom, telephone, couleur };
  if (typeof actif === 'boolean') patch.actif = actif;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('utilisateurs')
    .update(patch)
    .eq('id', id)
    .select()
    .single();

  if (error) return { error: error.message };

  revalidatePath('/admin/techniciens');
  return { ok: true, data };
}

export async function setTechActive(id: string, actif: boolean): Promise<ActionState> {
  const guard = await assertAdmin();
  if (guard) return guard;
  if (!id) return { error: 'ID manquant.' };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('utilisateurs')
    .update({ actif })
    .eq('id', id)
    .select()
    .single();

  if (error) return { error: error.message };

  revalidatePath('/admin/techniciens');
  return { ok: true, data };
}
