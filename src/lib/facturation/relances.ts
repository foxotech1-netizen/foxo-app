// Moteur de relances de paiement (chantier Facturation v2, bloc B).
//
// Niveaux depuis parametres.relance_delais_jours (défaut '7,14,30') :
// le niveau n est dû si aujourd'hui ≥ échéance + delais[n-1] ET
// rappel_count < n. Une facture = au plus UN niveau dû à la fois (le plus
// élevé atteint). Envoi : PDF + QR EPC joints (même génération que l'envoi
// de document), expéditeur Resend VENDOR_BILLING_FROM (même canal que les
// rappels manuels existants), sujet/corps par niveau (email-defaults).
//
// Tout est best-effort : une facture en échec n'arrête pas le lot.

import { renderToBuffer } from '@react-pdf/renderer';
import path from 'node:path';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmailResend } from '@/lib/email/resend';
import { VENDOR, VENDOR_BILLING_FROM } from '@/lib/constants/vendor';
import { getEmailForDoc } from '@/lib/notifications';
import { FactureFoxoPdf } from './FactureFoxoPdf';
import { generateEpcQrDataUrl } from './epc-qr';
import {
  buildRelanceEmail,
  buildDocumentEmailHtml,
  filenameForDocument,
  type NiveauRelance,
} from './email-defaults';
import { TZ_BRUSSELS } from '@/lib/format';
import type { Facture } from '@/lib/types/database';

const DEFAULT_DELAIS = [7, 14, 30];

export interface RelanceDue {
  facture: Facture;
  niveau_du: NiveauRelance;
  jours_de_retard: number;
}

function todayIsoBrussels(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ_BRUSSELS });
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.floor((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 86_400_000);
}

async function getDelais(): Promise<number[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('parametres')
    .select('valeur')
    .eq('cle', 'relance_delais_jours')
    .maybeSingle();
  const parsed = (data?.valeur ?? '')
    .split(',')
    .map((s: string) => parseInt(s.trim(), 10))
    .filter((n: number) => Number.isInteger(n) && n > 0);
  return parsed.length > 0 ? parsed.slice(0, 3) : DEFAULT_DELAIS;
}

// ─── a) Calcul des relances dues ───────────────────────────────────────────

export async function computeRelancesDues(): Promise<RelanceDue[]> {
  const admin = createAdminClient();
  const today = todayIsoBrussels();
  const delais = await getDelais();

  const { data, error } = await admin
    .from('factures')
    .select('*')
    .eq('type', 'facture')
    .eq('statut', 'envoyee')
    .is('deleted_at', null)
    .lt('date_echeance', today)
    .order('date_echeance', { ascending: true });
  if (error) throw new Error(`Lecture factures : ${error.message}`);

  const dues: RelanceDue[] = [];
  for (const row of (data ?? []) as Facture[]) {
    if (row.relances_pause) continue;
    if (!row.date_echeance) continue;
    const jours = daysBetween(row.date_echeance, today);
    // Niveau le plus élevé atteint par l'ancienneté du retard.
    let niveauAtteint = 0;
    for (let n = 1; n <= delais.length; n++) {
      if (jours >= delais[n - 1]) niveauAtteint = n;
    }
    if (niveauAtteint === 0) continue;
    // Dû seulement si ce niveau n'a pas déjà été envoyé.
    if ((row.rappel_count ?? 0) >= niveauAtteint) continue;
    dues.push({
      facture: row,
      niveau_du: Math.min(niveauAtteint, 3) as NiveauRelance,
      jours_de_retard: jours,
    });
  }
  return dues;
}

// ─── b) Envoi d'une relance (PDF + QR joints, best-effort) ────────────────

export type RelanceSendResult =
  | { ok: true; email: string }
  | { ok: false; error: string };

export async function envoyerRelance(
  factureId: string,
  niveau: NiveauRelance,
): Promise<RelanceSendResult> {
  const admin = createAdminClient();

  const { data: row } = await admin
    .from('factures')
    .select('*, intervention:interventions(id, syndic:organisations(id, email, email_factures, email_communications), acp:acps(id, email_factures, email_facturation, email_communications), particulier_contact)')
    .eq('id', factureId)
    .maybeSingle();
  if (!row) return { ok: false, error: 'Facture introuvable.' };

  type IvJoin = {
    id: string;
    syndic: { id: string; email: string | null; email_factures: string | null; email_communications: string | null } | null;
    acp: { id: string; email_factures: string | null; email_facturation: string | null; email_communications: string | null } | null;
    particulier_contact: { email?: string } | null;
  };
  const facture = row as Facture & { intervention: IvJoin | IvJoin[] | null };
  if (facture.type !== 'facture' || facture.statut !== 'envoyee' || facture.deleted_at) {
    return { ok: false, error: `Facture ${facture.numero} non éligible (statut ${facture.statut}).` };
  }
  if (facture.relances_pause) {
    return { ok: false, error: `Relances suspendues pour ${facture.numero}.` };
  }

  // Destinataire — même cascade que les rappels manuels existants.
  const ivRel = Array.isArray(facture.intervention) ? facture.intervention[0] : facture.intervention;
  const resolved = getEmailForDoc(
    {
      acp: ivRel?.acp ? {
        email_factures: ivRel.acp.email_factures,
        email_communications: ivRel.acp.email_communications,
        email_rapports: null,
        email_facturation: ivRel.acp.email_facturation,
        email_rapport: null,
      } : null,
      syndic: ivRel?.syndic ? {
        email: ivRel.syndic.email ?? '',
        email_factures: ivRel.syndic.email_factures,
        email_communications: ivRel.syndic.email_communications,
        email_rapports: null,
      } : null,
      particulier_contact: ivRel?.particulier_contact ?? null,
    },
    'facture',
  );
  const to = resolved.email ?? ((facture.client_email ?? '').trim() || null);
  if (!to) {
    return { ok: false, error: `Email destinataire introuvable pour ${facture.numero}.` };
  }

  // PDF + QR — même génération que l'envoi de document.
  const ttc = facture.montant_ttc ?? 0;
  let qrDataUrl: string | undefined;
  try {
    qrDataUrl = await generateEpcQrDataUrl({
      beneficiaryName: VENDOR.name,
      iban: VENDOR.iban,
      amountEur: ttc > 0 ? ttc : 0.01,
      bba: facture.reference_structuree ?? undefined,
    });
  } catch { /* QR non bloquant */ }

  let pdfBuffer: Buffer;
  try {
    const logoSrc = path.join(process.cwd(), 'public', 'foxo-logo-documents.png');
    pdfBuffer = await renderToBuffer(FactureFoxoPdf({ facture, qrDataUrl, logoSrc }));
  } catch (e) {
    return { ok: false, error: `PDF ${facture.numero} : ${e instanceof Error ? e.message : 'erreur'}` };
  }

  const today = todayIsoBrussels();
  const joursRetard = facture.date_echeance ? daysBetween(facture.date_echeance, today) : 0;
  const { subject, intro } = buildRelanceEmail({ facture, niveau, joursRetard });
  const html = buildDocumentEmailHtml({ facture, intro });

  const send = await sendEmailResend({
    to,
    subject,
    html,
    text: intro,
    from: VENDOR_BILLING_FROM,
    attachments: [{ filename: filenameForDocument(facture), content: pdfBuffer, contentType: 'application/pdf' }],
  });
  if (!send.ok) return { ok: false, error: `${facture.numero} : ${send.error}` };

  // Succès → le compteur saute directement au niveau envoyé.
  await admin
    .from('factures')
    .update({
      rappel_count: niveau,
      rappel_envoye_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', factureId);

  try {
    await admin.from('sms_logs').insert({
      intervention_id: ivRel?.id ?? null,
      to_phone: to,
      channel: 'email',
      type: 'facture_relance',
      message: `Relance niveau ${niveau} facture ${facture.numero} (${joursRetard}j de retard) → ${to}`,
      status: 'sent',
      cost_estimate_eur: 0,
      sent_by: 'relances',
      twilio_sid: send.id,
    });
  } catch { /* noop log */ }

  return { ok: true, email: to };
}

// ─── c) Boucle complète ─────────────────────────────────────────────────────

export interface RelanceCandidate {
  facture_id: string;
  numero: string;
  client_nom: string | null;
  montant_ttc: number | null;
  date_echeance: string | null;
  niveau_du: NiveauRelance;
  jours_de_retard: number;
}

export interface RunRelancesResult {
  candidates: RelanceCandidate[];
  envoyees: number;
  erreurs: { numero: string; error: string }[];
}

export async function runRelancesAuto(args?: {
  dryRun?: boolean;
  limit?: number;
}): Promise<RunRelancesResult> {
  const dryRun = args?.dryRun ?? false;
  const limit = Math.max(1, Math.min(args?.limit ?? 20, 100));

  const dues = await computeRelancesDues();
  const candidates: RelanceCandidate[] = dues.map((d) => ({
    facture_id: d.facture.id,
    numero: d.facture.numero,
    client_nom: d.facture.client_nom,
    montant_ttc: d.facture.montant_ttc,
    date_echeance: d.facture.date_echeance,
    niveau_du: d.niveau_du,
    jours_de_retard: d.jours_de_retard,
  }));

  if (dryRun) return { candidates, envoyees: 0, erreurs: [] };

  let envoyees = 0;
  const erreurs: { numero: string; error: string }[] = [];
  for (const due of dues.slice(0, limit)) {
    try {
      const res = await envoyerRelance(due.facture.id, due.niveau_du);
      if (res.ok) envoyees++;
      else erreurs.push({ numero: due.facture.numero, error: res.error });
    } catch (e) {
      erreurs.push({
        numero: due.facture.numero,
        error: e instanceof Error ? e.message : 'Erreur inconnue.',
      });
    }
  }
  return { candidates, envoyees, erreurs };
}
