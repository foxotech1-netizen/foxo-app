'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { dispatchRapportToSyndic } from '@/lib/rapport/dispatch';
import { roleForEmail } from '@/lib/auth/roles';
import { generateFacturePdf } from '@/lib/pdf/generateFacture';
import { computeTotals, type FactureItem } from '@/lib/pdf/FacturePdf';
import { VENDOR } from '@/lib/constants/vendor';
import type { Acp, Intervention, Organisation, StatutIntervention } from '@/lib/types/database';

export type ActionState = { ok?: true; error?: string; data?: unknown };

const STATUTS_VALIDES: StatutIntervention[] = [
  'nouvelle','attente','confirmee','realisee','rapport','cloturee','en_suspens',
];

export async function updateInterventionStatus(
  id: string,
  newStatut: StatutIntervention,
  suspensMotif?: string | null,
): Promise<ActionState> {
  if (!id) return { error: 'ID manquant.' };
  if (!STATUTS_VALIDES.includes(newStatut)) return { error: 'Statut invalide.' };

  const supabase = await createClient();
  const patch: Record<string, unknown> = {
    statut: newStatut,
    updated_at: new Date().toISOString(),
  };
  if (newStatut === 'en_suspens') patch.suspens_motif = suspensMotif ?? null;

  const { error } = await supabase.from('interventions').update(patch).eq('id', id);
  if (error) return { error: error.message };

  revalidatePath('/admin');
  return { ok: true };
}

export async function createOrganisation(formData: FormData): Promise<ActionState> {
  const nom = String(formData.get('nom') ?? '').trim();
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const type = String(formData.get('type') ?? 'syndic') as 'syndic' | 'courtier';
  const contact = String(formData.get('contact') ?? '').trim() || null;
  const telephone = String(formData.get('telephone') ?? '').trim() || null;
  const bce = String(formData.get('bce') ?? '').trim() || null;
  const adresse = String(formData.get('adresse') ?? '').trim() || null;

  if (!nom) return { error: 'Le nom de la société est obligatoire.' };
  if (!email || !email.includes('@')) return { error: 'Email invalide.' };
  if (type !== 'syndic' && type !== 'courtier') return { error: 'Type invalide.' };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('organisations')
    .insert({ nom, email, type, contact, telephone, bce, adresse })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') return { error: 'Cet email est déjà enregistré.' };
    return { error: error.message };
  }

  revalidatePath('/admin/syndics');
  return { ok: true, data };
}

// Envoi manuel du rapport au syndic depuis l'admin (résend / 1ère fois si auto-send a échoué).
export async function resendRapportToSyndic(interventionId: string): Promise<ActionState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || roleForEmail(user.email) !== 'admin') {
    return { error: 'Accès refusé.' };
  }
  const res = await dispatchRapportToSyndic(interventionId);
  if (!res.ok) return { error: res.error };
  revalidatePath(`/admin`);
  return { ok: true, data: { emailId: res.emailId } };
}

// ── Facture ───────────────────────────────────────────────────────────────

export type EmitFactureInput = {
  interventionId: string;
  items: FactureItem[];
  vatRate: number;
  notes: string;
};

export type EmitFactureResult =
  | { ok: true; data: { numero: string; montantTTC: number } }
  | { error: string };

export async function emitFacture(input: EmitFactureInput): Promise<EmitFactureResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || roleForEmail(user.email) !== 'admin') {
    return { error: 'Accès refusé.' };
  }

  if (!input.interventionId) return { error: 'ID manquant.' };
  if (!Array.isArray(input.items) || input.items.length === 0) {
    return { error: 'Au moins une ligne de prestation est requise.' };
  }
  for (const it of input.items) {
    if (!it.description?.trim()) return { error: 'Chaque ligne doit avoir une description.' };
    if (!Number.isFinite(it.quantity) || it.quantity <= 0) return { error: 'Quantité invalide.' };
    if (!Number.isFinite(it.unitPrice) || it.unitPrice < 0) return { error: 'Prix unitaire invalide.' };
  }
  if (!Number.isFinite(input.vatRate) || input.vatRate < 0 || input.vatRate > 100) {
    return { error: 'Taux TVA invalide.' };
  }

  // Charge l'intervention + ACP + syndic
  const { data: ivData } = await supabase
    .from('interventions')
    .select('*')
    .eq('id', input.interventionId)
    .maybeSingle();
  if (!ivData) return { error: 'Intervention introuvable.' };
  const iv = ivData as Intervention;

  const [acpRes, orgRes] = await Promise.all([
    iv.acp_id
      ? supabase.from('acps').select('*').eq('id', iv.acp_id).maybeSingle()
      : Promise.resolve({ data: null }),
    iv.syndic_id
      ? supabase.from('organisations').select('*').eq('id', iv.syndic_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const acp = acpRes.data as Acp | null;
  const org = orgRes.data as Organisation | null;

  if (!org) return { error: 'Organisation cliente introuvable.' };

  const ref = iv.ref ?? input.interventionId.slice(0, 8);
  const numero = `F-${ref}`;
  const today = new Date();
  const echeance = new Date(today);
  echeance.setDate(echeance.getDate() + VENDOR.PAYMENT_TERMS_DAYS);

  const totals = computeTotals(input.items, input.vatRate);

  const acpAdresse = acp
    ? [acp.adresse, acp.code_postal, acp.ville].filter(Boolean).join(', ')
    : '—';

  const pdfBuffer = await generateFacturePdf({
    numero,
    dateEmission: today.toISOString(),
    dateEcheance: echeance.toISOString(),
    ref,
    client: {
      nom: org.nom,
      type: org.type,
      adresse: org.adresse,
      bce: org.bce,
    },
    serviceLocation: {
      acpNom: acp?.nom ?? '—',
      adresse: acpAdresse || '—',
    },
    bonCommande: iv.ref_bon_commande,
    items: input.items,
    vatRate: input.vatRate,
    notes: input.notes ?? '',
  });

  // Upload (overwrite si déjà émise)
  const path = `${input.interventionId}.pdf`;
  const { error: upErr } = await supabase.storage
    .from('invoices')
    .upload(path, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true,
    });
  if (upErr) return { error: 'Upload bucket : ' + upErr.message };

  // MAJ statut → cloturee à l'émission de la facture (sauf statuts amont
  // comme nouvelle/en_suspens qu'on laisse intacts).
  const targetStatuts: StatutIntervention[] = ['rapport', 'realisee'];
  const update: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (targetStatuts.includes(iv.statut)) {
    update.statut = 'cloturee';
  }
  // (en_suspens, nouvelle, attente, confirmee : statut inchangé)

  await supabase.from('interventions').update(update).eq('id', input.interventionId);

  revalidatePath('/admin');
  return { ok: true, data: { numero, montantTTC: totals.ttc } };
}
