import { createClient } from '@/lib/supabase/server';
import { generateRapportPdf } from '@/lib/pdf/generate';
import { sendRapportEmail } from '@/lib/email/rapport';
import { uploadRapport } from '@/lib/google-drive';
import { getEmailForDoc } from '@/lib/notifications';
import type { Acp, Intervention, Organisation, ParticulierContact, Rapport, Utilisateur } from '@/lib/types/database';

export type DispatchResult = { ok: true; emailId?: string } | { ok: false; error: string };
export type BuildResult =
  | {
      ok: true;
      pdfBuffer: Buffer;
      ref: string;
      acpNom: string;
      acpAdresse: string;
      interventionId: string;
      sections: {
        degats: string;
        inspection: string;
        conclusion: string;
        recommandations: string;
      };
      // ↓ Champs pour buildRapportDocx (template FoxO 2026-104)
      refSyndic: string | null;
      description: string;
      adresseFacturation: string;
      adresseIntervention: string;
      observations: Array<{
        test_type: string;
        etage: string | null;
        localisation: string | null;
        notes: string | null;
      }>;
      syndicEmail: string | null;
      syndicNom: string | null;
      technicienNom: string | null;
    }
  | { ok: false; error: string };

// Charge les données pour une intervention, génère le PDF du rapport.
// Pas de vérification de droits ici : à appeler uniquement après un contrôle
// d'autorisation côté caller (server action / route handler).
export async function buildRapportPdf(interventionId: string): Promise<BuildResult> {
  const supabase = await createClient();

  const { data: ivData, error: ivErr } = await supabase
    .from('interventions')
    .select('*')
    .eq('id', interventionId)
    .maybeSingle();
  if (ivErr) return { ok: false, error: ivErr.message };
  if (!ivData) return { ok: false, error: 'Intervention introuvable.' };
  const iv = ivData as Intervention;

  const [acpRes, syndicRes, techRes, rapRes, occRes, obsRes] = await Promise.all([
    iv.acp_id
      ? supabase.from('acps').select('*').eq('id', iv.acp_id).maybeSingle()
      : Promise.resolve({ data: null }),
    iv.syndic_id
      ? supabase.from('organisations').select('id, nom, adresse, email, type, email_factures, email_rapports, email_communications').eq('id', iv.syndic_id).maybeSingle()
      : Promise.resolve({ data: null }),
    iv.technicien_id
      ? supabase.from('utilisateurs').select('id, prenom, nom').eq('id', iv.technicien_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from('rapports').select('*').eq('intervention_id', iv.id).maybeSingle(),
    supabase.from('occupants').select('appartement').eq('intervention_id', iv.id).order('appartement', { ascending: true }),
    supabase.from('observations_terrain').select('test_type, etage, localisation, notes').eq('intervention_id', iv.id).order('created_at', { ascending: true }),
  ]);

  const acp = acpRes.data as Acp | null;
  const syndic = syndicRes.data as Pick<Organisation, 'id' | 'nom' | 'adresse' | 'email' | 'type' | 'email_factures' | 'email_rapports' | 'email_communications'> | null;
  const tech = techRes.data as Pick<Utilisateur, 'id' | 'prenom' | 'nom'> | null;
  const rapport = rapRes.data as Rapport | null;
  const appartements = ((occRes.data ?? []) as { appartement: string | null }[])
    .map((o) => o.appartement)
    .filter((a): a is string => Boolean(a && a.trim()));
  const observations = (obsRes.data ?? []) as Array<{
    test_type: string;
    etage: string | null;
    localisation: string | null;
    notes: string | null;
  }>;

  if (!rapport) return { ok: false, error: 'Aucun rapport rédigé pour cette intervention.' };

  const acpAdresse = [acp?.adresse, acp?.code_postal, acp?.ville].filter(Boolean).join(', ');
  const techNom = tech ? [tech.prenom, tech.nom].filter(Boolean).join(' ') : null;
  const ref = iv.ref ?? '—';
  const acpNom = acp?.nom ?? '—';

  const pdfBuffer = await generateRapportPdf({
    ref,
    acpNom,
    acpAdresse: acpAdresse || '—',
    type: iv.type ?? '—',
    description: iv.description ?? '',
    priorite: iv.priorite,
    creneauDebut: iv.creneau_debut,
    startedAt: iv.started_at,
    endedAt: iv.ended_at,
    syndicNom: syndic?.nom ?? null,
    technicienNom: techNom,
    appartements,
    rapport: {
      degats: rapport.degats ?? '',
      inspection: rapport.inspection ?? '',
      conclusion: rapport.conclusion ?? '',
      recommandations: rapport.recommandations ?? '',
    },
    generatedAt: new Date().toISOString(),
  });

  // Destinataire résolu via la cascade ACP → Syndic → legacy → particulier
  // Voir lib/notifications.ts pour le détail. On garde syndicEmail comme
  // fallback dans le type pour compat avec les callers existants.
  const recipient = getEmailForDoc({
    acp,
    syndic,
    particulier_contact: iv.particulier_contact as ParticulierContact | null,
  }, 'rapport');

  // ─── Composition des champs du tableau d'identification (FoxO 2026-104) ──
  const refSyndic = (iv.reference_externe ?? '').trim() || null;
  const description = iv.description?.trim()
    || rapport.degats?.split(/\r?\n/)[0]?.slice(0, 200)
    || '—';

  const factuLines: string[] = [];
  const factuName = iv.nom_facturation || syndic?.nom;
  if (factuName) factuLines.push(factuName);
  if (syndic?.adresse) factuLines.push(syndic.adresse);
  const factuEmail = iv.email_facturation || syndic?.email;
  if (factuEmail) factuLines.push(factuEmail);
  if (iv.bce_facturation) factuLines.push(`BCE : ${iv.bce_facturation}`);
  const adresseFacturation = factuLines.length > 0 ? factuLines.join('\n') : '—';

  const intervLines: string[] = [];
  if (acp?.nom) intervLines.push(acp.nom);
  if (acpAdresse) intervLines.push(acpAdresse);
  const etagesSet = new Set(
    observations.map((o) => o.etage).filter((e): e is string => Boolean(e)),
  );
  if (etagesSet.size > 0) {
    intervLines.push(`Étages : ${[...etagesSet].sort().join(', ')}`);
  }
  const adresseIntervention = intervLines.length > 0
    ? intervLines.join('\n')
    : (iv.adresse ?? '—');

  return {
    ok: true,
    pdfBuffer,
    ref,
    acpNom,
    acpAdresse: acpAdresse || '—',
    interventionId: iv.id,
    sections: {
      degats: rapport.degats ?? '',
      inspection: rapport.inspection ?? '',
      conclusion: rapport.conclusion ?? '',
      recommandations: rapport.recommandations ?? '',
    },
    refSyndic,
    description,
    adresseFacturation,
    adresseIntervention,
    observations,
    syndicEmail: recipient.email ?? syndic?.email ?? null,
    syndicNom: syndic?.nom ?? null,
    technicienNom: techNom,
  };
}

// Envoi email — réutilise buildRapportPdf en interne.
export async function dispatchRapportToSyndic(interventionId: string): Promise<DispatchResult> {
  const built = await buildRapportPdf(interventionId);
  if (!built.ok) return { ok: false, error: built.error };
  if (!built.syndicEmail) return { ok: false, error: 'Email du syndic introuvable.' };

  const sent = await sendRapportEmail({
    to: built.syndicEmail,
    acpNom: built.acpNom,
    ref: built.ref,
    syndicNom: built.syndicNom,
    technicienNom: built.technicienNom,
    pdfBuffer: built.pdfBuffer,
  });

  if (!sent.ok) return { ok: false, error: sent.error };

  // Upload sur Drive en best-effort (non bloquant pour l'envoi email)
  const year = new Date().getFullYear();
  const adresse = built.acpNom; // adresse simplifiée — le builder retournait acpNom

  try {
    await uploadRapport({
      ref: built.ref,
      adresse,
      year,
      bytes: new Uint8Array(built.pdfBuffer),
    });
  } catch (e) {
    console.warn('[dispatchRapport] uploadRapport Drive (PDF) skipped:', e);
  }

  // Génération + upload du .docx — version éditable du rapport sur Drive,
  // utile pour les retouches manuelles avant la version PDF finale.
  try {
    const { buildRapportDocx } = await import('@/lib/rapport/build-docx');
    const docxBytes = await buildRapportDocx({
      interventionId: built.interventionId,
      ref: built.ref,
      refSyndic: built.refSyndic,
      description: built.description,
      adresseFacturation: built.adresseFacturation,
      adresseIntervention: built.adresseIntervention,
      date: new Date(),
      sections: built.sections,
      observations: built.observations,
    });
    await uploadRapport({
      ref: built.ref,
      adresse,
      year,
      bytes: docxBytes,
      filename: `${built.ref} ${adresse}.docx`,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
  } catch (e) {
    console.warn('[dispatchRapport] uploadRapport Drive (DOCX) skipped:', e);
  }

  return { ok: true, emailId: sent.id };
}
