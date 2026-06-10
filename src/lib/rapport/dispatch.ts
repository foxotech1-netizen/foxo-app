import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { generateRapportPdf } from '@/lib/pdf/generate';
import { sendRapportEmail } from '@/lib/email/rapport';
import { uploadRapport } from '@/lib/google-drive';
import { getEmailThread, sendMailReply } from '@/lib/gmail';
import { getEmailForDoc } from '@/lib/notifications';
import type { ReportData } from '@/lib/rapport/build-docx';
import {
  buildObjet,
  buildFacturationLines,
  buildAdresseInterventionLine1,
  buildAdresseInterventionLine2,
  buildRefLabelValue,
  buildTechniques,
  fmtDateShort,
} from '@/lib/rapport/report-data-mapping';
import { techniquesFromKeys } from '@/lib/rapport/techniques';
import type { Acp, Intervention, Occupant, Organisation, ParticulierContact, Rapport, Utilisateur } from '@/lib/types/database';

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
      // ReportData prêt pour buildRapportDocx (template FOXO_BASE).
      reportData: ReportData;
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

  // Colonnes étendues pour le mapping ReportData modèle 2026-101 :
  //   - syndic.bce + syndic.contact : ligne 1/2 facturation
  //   - occupant.prenom + type_occupant : "Apt X : Prénom Nom (type)"
  const [acpRes, syndicRes, techRes, rapRes, occRes, obsRes] = await Promise.all([
    iv.acp_id
      ? supabase.from('acps').select('*').eq('id', iv.acp_id).maybeSingle()
      : Promise.resolve({ data: null }),
    iv.syndic_id
      ? supabase.from('organisations').select('id, nom, adresse, email, type, contact, bce, email_factures, email_rapports, email_communications').eq('id', iv.syndic_id).maybeSingle()
      : Promise.resolve({ data: null }),
    iv.technicien_id
      ? supabase.from('utilisateurs').select('id, prenom, nom').eq('id', iv.technicien_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from('rapports').select('*').eq('intervention_id', iv.id).maybeSingle(),
    supabase.from('occupants').select('appartement, prenom, nom, type_occupant').eq('intervention_id', iv.id).order('appartement', { ascending: true }),
    supabase.from('observations_terrain').select('test_type').eq('intervention_id', iv.id).order('created_at', { ascending: true }),
  ]);

  const acp = acpRes.data as Acp | null;
  const syndic = syndicRes.data as Pick<Organisation, 'id' | 'nom' | 'adresse' | 'email' | 'type' | 'contact' | 'bce' | 'email_factures' | 'email_rapports' | 'email_communications'> | null;
  const tech = techRes.data as Pick<Utilisateur, 'id' | 'prenom' | 'nom'> | null;
  const rapport = rapRes.data as Rapport | null;
  const occupants = (occRes.data ?? []) as Pick<Occupant, 'appartement' | 'prenom' | 'nom' | 'type_occupant'>[];
  const observations = (obsRes.data ?? []) as Array<{ test_type: string }>;

  if (!rapport) return { ok: false, error: 'Aucun rapport rédigé pour cette intervention.' };

  const acpAdresse = [acp?.adresse, acp?.code_postal, acp?.ville].filter(Boolean).join(', ');
  const techNom = tech ? [tech.prenom, tech.nom].filter(Boolean).join(' ') : null;
  const ref = iv.ref ?? '—';
  const acpNom = acp?.nom ?? '—';

  // Destinataire résolu via la cascade ACP → Syndic → legacy → particulier
  // Voir lib/notifications.ts pour le détail. On garde syndicEmail comme
  // fallback dans le type pour compat avec les callers existants.
  const recipient = getEmailForDoc({
    acp,
    syndic,
    particulier_contact: iv.particulier_contact as ParticulierContact | null,
  }, 'rapport');

  // ─── Composition ReportData (template FOXO_BASE) — SOURCE UNIQUE ─────
  //
  // Un seul ReportData alimente les DEUX moteurs (PDF jumeau via
  // generateRapportPdf, DOCX via buildRapportDocx) : aucun double chemin de
  // données. Helpers partagés avec route.ts (rapport-docx export brouillon).
  const today = new Date();

  // Le builder splitte sur '||PARA||' pour produire un Paragraph par bloc
  // (cf. textToParas dans build-docx.ts). Les doubles sauts de ligne
  // saisis par le tech (ou Claude) deviennent des séparateurs.
  const toParaFmt = (s: string) => (s ?? '').replace(/\n\n/g, '||PARA||');

  const refLabelValue = buildRefLabelValue(iv, today);
  const facturationLines = buildFacturationLines(iv, acp, syndic);

  // Techniques : snapshot persisté (rapports.techniques) prioritaire ; fallback
  // sur la dérivation observations_terrain tant que le snapshot n'est pas peuplé.
  const techKeys = (rapport as { techniques?: string[] | null } | null)?.techniques ?? null;
  const techniques = techKeys && techKeys.length > 0
    ? techniquesFromKeys(techKeys)
    : buildTechniques(observations);

  const reportData: ReportData = {
    numero: ref,
    ref_label: refLabelValue.ref_label,
    ref_value: refLabelValue.ref_value,
    objet: buildObjet(rapport, acp, iv),
    ...facturationLines,
    adresse_ligne1: buildAdresseInterventionLine1(acp, iv),
    adresse_ligne2: buildAdresseInterventionLine2(occupants),
    adresse_ligne3: '',
    techniques,
    degats: toParaFmt(rapport.degats ?? ''),
    inspection: toParaFmt(rapport.inspection ?? ''),
    conclusion: toParaFmt(rapport.conclusion ?? ''),
    recommandation: toParaFmt(rapport.recommandations ?? ''),
    fait_a_date: fmtDateShort(today),
  };

  // PDF jumeau du template, généré depuis le MÊME ReportData que le docx.
  const pdfBuffer = await generateRapportPdf(reportData);

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
    reportData,
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

  let pdfUp: { ok: boolean; file_id?: string; web_view_link?: string } | null = null;
  try {
    pdfUp = await uploadRapport({
      ref: built.ref,
      adresse,
      year,
      bytes: new Uint8Array(built.pdfBuffer),
    });
  } catch (e) {
    console.error('[dispatch] pdf upload failed', e);
  }

  // Génération + upload du .docx — version éditable du rapport sur Drive,
  // utile pour les retouches manuelles avant la version PDF finale.
  let docxUp: { ok: boolean; file_id?: string; web_view_link?: string } | null = null;
  try {
    const { buildRapportDocx } = await import('@/lib/rapport/build-docx');
    const docxBytes = await buildRapportDocx({
      interventionId: built.interventionId,
      data: built.reportData,
      date: new Date(),
    });
    docxUp = await uploadRapport({
      ref: built.ref,
      adresse,
      year,
      bytes: docxBytes,
      filename: `${built.ref} ${adresse}.docx`,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
  } catch (e) {
    console.error('[dispatch] docx upload failed', e);
  }

  // ── Best-effort : marquer le rapport transmis en base ──
  try {
    const db = createAdminClient();
    await db
      .from('rapports')
      .update({
        statut: 'transmis',
        transmis_at: new Date().toISOString(),
        transmis_a: [built.syndicEmail],
        ...(pdfUp?.ok  ? { pdf_drive_url: pdfUp.web_view_link,  pdf_drive_file_id: pdfUp.file_id  } : {}),
        ...(docxUp?.ok ? { docx_drive_url: docxUp.web_view_link, docx_drive_file_id: docxUp.file_id } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('intervention_id', interventionId);
  } catch (e) {
    console.error('[dispatch] failed to mark rapport as transmis', e);
  }

  // ── Clôture automatique du dossier après transmission RÉUSSIE ──
  // On n'atteint ce point que si l'envoi email a réussi (return anticipé sinon).
  // La transmission EST la notification : aucun notifyStatusChange ici (silencieux).
  // Best-effort : un échec de cet UPDATE ne doit pas faire échouer la transmission.
  try {
    const db = createAdminClient();
    await db
      .from('interventions')
      .update({ statut: 'cloturee', updated_at: new Date().toISOString() })
      .eq('id', interventionId);
  } catch (e) {
    console.error('[dispatch] failed to mark intervention as cloturee', e);
  }

  // Étape 4 — reply-in-thread Gmail « rapport dispo » (best-effort, jamais bloquant).
  // Quand l'intervention vient d'un mail, on répond DANS le fil d'origine
  // (In-Reply-To + References + threadId gérés par sendMailReply).
  try {
    const adminDb = createAdminClient();

    // buildRapportPdf n'expose ni source ni source_mail_id → relecture ciblée.
    const { data: ivRow } = await adminDb
      .from('interventions')
      .select('source, source_mail_id')
      .eq('id', interventionId)
      .maybeSingle();
    const iv = ivRow as { source: string | null; source_mail_id: string | null } | null;
    const interventionSource = iv?.source ?? null;
    const sourceMailId = iv?.source_mail_id ?? null;

    if (interventionSource === 'mail' && sourceMailId) {
      // Retrouve le thread via mails_analyses (robuste — source_mail_id peut être
      // un thread_id OU un message_id selon l'origine de création).
      const { data: mailAnalyse } = await adminDb
        .from('mails_analyses')
        .select('thread_id')
        .eq('dossier_match_id', interventionId)
        .limit(1)
        .maybeSingle();
      const threadId = (mailAnalyse as { thread_id: string | null } | null)?.thread_id ?? sourceMailId;

      // Dernier message du fil → In-Reply-To/References corrects.
      const thread = await getEmailThread(threadId);
      const messages = thread.ok ? thread.messages : [];
      // On cible le premier message du fil (la demande d'origine du syndic)
      // pour garantir que le reply lui est adressé — sendMailReply dérive le
      // destinataire depuis origFrom de ce message.
      const originMessageId = messages.length > 0 ? messages[0].id : null;

      if (originMessageId) {
        // pdfUp = upload Drive du PDF qu'on vient de faire (même valeur que
        // rapports.pdf_drive_url posé juste au-dessus). built.ref = réf dossier.
        const pdfUrl = pdfUp?.ok ? (pdfUp.web_view_link ?? null) : null;
        const refDossier = built.ref;

        const body = [
          'Bonjour,',
          '',
          "Le rapport d'intervention relatif à votre demande est désormais disponible.",
          '',
          `Référence dossier : ${refDossier}`,
          pdfUrl ? `Rapport complet : ${pdfUrl}` : null,
          '',
          'Cordialement,',
          "L'équipe FoxO",
        ]
          .filter((line) => line !== null)
          .join('\n');

        // Nom de la pièce jointe = même schéma que le .docx déposé sur Drive
        // ("{ref} {acpNom}"), ex. "2026-127 Rue Willems 14.pdf". Repli sur la
        // seule référence si acpNom est absent ("—").
        const attachmentFilename =
          built.acpNom && built.acpNom !== '—'
            ? `${built.ref} ${built.acpNom}.pdf`
            : `${built.ref}.pdf`;

        await sendMailReply({
          mailId: originMessageId,
          body,
          attachment: {
            filename: attachmentFilename,
            content: built.pdfBuffer,
            contentType: 'application/pdf',
          },
        });
      }
    }
  } catch (replyError) {
    console.error('[dispatchRapportToSyndic] reply-in-thread failed (non-blocking):', replyError);
  }

  return { ok: true, emailId: sent.id };
}
