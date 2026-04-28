'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { dispatchRapportToSyndic } from '@/lib/rapport/dispatch';
import { roleForEmail } from '@/lib/auth/roles';
import { generateFacturePdf } from '@/lib/pdf/generateFacture';
import { computeTotals, type FactureItem } from '@/lib/pdf/FacturePdf';
import { VENDOR } from '@/lib/constants/vendor';
import { notifyStatusChange } from '@/lib/email/notifications';
import type { Acp, Intervention, Organisation, StatutIntervention } from '@/lib/types/database';

export type ActionState = { ok?: true; error?: string; data?: unknown };

const STATUTS_VALIDES: StatutIntervention[] = [
  'nouvelle','attente','confirmee','realisee','rapport','cloturee','en_suspens',
];

export async function assignTechnician(
  interventionId: string,
  technicienId: string | null,
): Promise<ActionState> {
  if (!interventionId) return { error: 'ID manquant.' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('interventions')
    .update({
      technicien_id: technicienId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', interventionId);

  if (error) return { error: error.message };
  revalidatePath('/admin');
  return { ok: true };
}

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

  // Email automatique sur changement de statut (best-effort)
  try {
    await notifyStatusChange(id, newStatut);
  } catch (e) {
    console.warn('[admin/updateInterventionStatus] notify failed:', e);
  }

  revalidatePath('/admin');
  return { ok: true };
}

// ── Upload manuel de documents ─────────────────────────────────────

export type DocumentKind = 'rapport' | 'facture';

export type UploadedDocument = {
  kind: DocumentKind;
  name: string;
  path: string;
  size: number;
  createdAt: string | null;
};

export async function getInterventionDocuments(
  interventionId: string,
): Promise<UploadedDocument[]> {
  const supabase = await createClient();
  const out: UploadedDocument[] = [];

  // Rapport : documents/{id}/rapport.pdf
  const { data: rapList } = await supabase.storage.from('documents').list(interventionId);
  const rap = (rapList ?? []).find((f) => f.name === 'rapport.pdf');
  if (rap) {
    out.push({
      kind: 'rapport',
      name: 'rapport.pdf',
      path: `${interventionId}/rapport.pdf`,
      size: (rap.metadata as { size?: number } | null)?.size ?? 0,
      createdAt: rap.created_at ?? null,
    });
  }

  // Facture : invoices/{id}.pdf
  const { data: facList } = await supabase.storage.from('invoices').list();
  const fac = (facList ?? []).find((f) => f.name === `${interventionId}.pdf`);
  if (fac) {
    out.push({
      kind: 'facture',
      name: `${interventionId}.pdf`,
      path: `${interventionId}.pdf`,
      size: (fac.metadata as { size?: number } | null)?.size ?? 0,
      createdAt: fac.created_at ?? null,
    });
  }

  return out;
}

const MAX_PDF_BYTES = 10 * 1024 * 1024;

export async function uploadInterventionDocument(formData: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || roleForEmail(user.email) !== 'admin') {
    return { error: 'Accès refusé.' };
  }

  const interventionId = String(formData.get('interventionId') ?? '').trim();
  const kind = String(formData.get('kind') ?? '') as DocumentKind;
  const file = formData.get('file');

  if (!interventionId) return { error: 'ID manquant.' };
  if (kind !== 'rapport' && kind !== 'facture') return { error: 'Type invalide.' };
  if (!(file instanceof File)) return { error: 'Fichier manquant.' };
  if (file.size === 0) return { error: 'Fichier vide.' };
  if (file.size > MAX_PDF_BYTES) return { error: 'Fichier trop lourd (max 10 MB).' };
  if (file.type && file.type !== 'application/pdf') return { error: 'Seuls les PDF sont acceptés.' };

  const admin = createAdminClient();
  const buffer = Buffer.from(await file.arrayBuffer());

  const bucket = kind === 'rapport' ? 'documents' : 'invoices';
  const path = kind === 'rapport' ? `${interventionId}/rapport.pdf` : `${interventionId}.pdf`;

  const { error: upErr } = await admin.storage
    .from(bucket)
    .upload(path, buffer, { contentType: 'application/pdf', upsert: true });
  if (upErr) return { error: 'Upload : ' + upErr.message };

  // Update statut selon type d'upload (sauf si plus avancé déjà)
  const targetStatut: StatutIntervention = kind === 'rapport' ? 'rapport' : 'cloturee';
  const amontRapport: StatutIntervention[] = ['nouvelle', 'attente', 'confirmee', 'realisee'];
  const amontCloturee: StatutIntervention[] = ['nouvelle', 'attente', 'confirmee', 'realisee', 'rapport'];

  const { data: iv } = await admin
    .from('interventions')
    .select('statut')
    .eq('id', interventionId)
    .maybeSingle();

  const currentStatut = iv?.statut as StatutIntervention | undefined;
  const shouldUpdate = currentStatut && (
    (kind === 'rapport' && amontRapport.includes(currentStatut)) ||
    (kind === 'facture' && amontCloturee.includes(currentStatut))
  );

  if (shouldUpdate) {
    await admin
      .from('interventions')
      .update({ statut: targetStatut, updated_at: new Date().toISOString() })
      .eq('id', interventionId);
    try { await notifyStatusChange(interventionId, targetStatut); } catch {}
  }

  revalidatePath('/admin');
  return { ok: true };
}

export async function deleteInterventionDocument(
  interventionId: string,
  kind: DocumentKind,
): Promise<ActionState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || roleForEmail(user.email) !== 'admin') {
    return { error: 'Accès refusé.' };
  }

  const admin = createAdminClient();
  const bucket = kind === 'rapport' ? 'documents' : 'invoices';
  const path = kind === 'rapport' ? `${interventionId}/rapport.pdf` : `${interventionId}.pdf`;

  const { error } = await admin.storage.from(bucket).remove([path]);
  if (error) return { error: 'Suppression : ' + error.message };

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

// Sauvegarde un brouillon de rapport généré par l'assistant IA depuis le drawer admin.
// Le tech voit ensuite ce brouillon dans /tech/interventions/[id] et peut éditer avant publication.
export async function saveRapportDraftFromAdmin(
  interventionId: string,
  sections: { degats: string; inspection: string; conclusion: string; recommandations: string },
): Promise<ActionState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || roleForEmail(user.email) !== 'admin') {
    return { error: 'Accès refusé.' };
  }
  if (!interventionId) return { error: 'ID manquant.' };

  const { error } = await supabase
    .from('rapports')
    .upsert(
      {
        intervention_id: interventionId,
        degats: sections.degats,
        inspection: sections.inspection,
        conclusion: sections.conclusion,
        recommandations: sections.recommandations,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'intervention_id' },
    );
  if (error) return { error: error.message };
  revalidatePath('/admin');
  return { ok: true };
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

  // Si on a transité vers cloturee, notifier le syndic avec la facture en pj
  if (update.statut === 'cloturee') {
    try { await notifyStatusChange(input.interventionId, 'cloturee'); } catch {}
  }

  revalidatePath('/admin');
  return { ok: true, data: { numero, montantTTC: totals.ttc } };
}
