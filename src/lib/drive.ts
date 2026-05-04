// Sync Drive d'une intervention — orchestre la génération du PDF rapport
// et son upload dans le dossier Drive structuré.
//
// Réutilise toute la chaîne existante :
//   - buildRapportPdf (lib/rapport/dispatch.ts) pour générer le PDF
//     (fetch intervention + acp + tech + rapport + occupants, render
//     react-pdf, retourne pdfBuffer + ref).
//   - uploadRapport (lib/google-drive.ts) pour le push OAuth dans
//     RAPPORTS/[year]/[ref + adresse]/rapport.pdf (versioning : update
//     du contenu si le fichier existe déjà).
//
// Les photos sont déjà sur Drive au moment de leur capture (cf. uploadPhoto
// appelé par /api/tech/upload-photo). Cette fonction ne re-uploade pas les
// photos — elle compte juste le nombre déjà présent dans la table
// photos_interventions pour le retour informatif.
//
// Tolérance : si aucun rapport n'a été rédigé (erreur 'Aucun rapport
// rédigé…' de buildRapportPdf), on retourne ok:true avec rapport_url
// undefined — le compte de photos reste pertinent.

import { createClient } from '@/lib/supabase/server';
import { buildRapportPdf } from '@/lib/rapport/dispatch';
import { uploadRapport } from '@/lib/google-drive';
import type { Acp, Intervention } from '@/lib/types/database';

export type DriveSyncResult =
  | { ok: true; rapport_url?: string; photos_count: number }
  | { ok: false; error: string };

export async function syncInterventionToDrive(
  interventionId: string,
): Promise<DriveSyncResult> {
  const supabase = await createClient();

  // ── 1. Charge l'intervention (ref, adresse, year) ───────────────────
  const { data: ivRow, error: ivErr } = await supabase
    .from('interventions')
    .select('id, ref, adresse, acp_id, created_at')
    .eq('id', interventionId)
    .maybeSingle();
  if (ivErr) return { ok: false, error: ivErr.message };
  if (!ivRow) return { ok: false, error: 'Intervention introuvable.' };
  const iv = ivRow as Pick<Intervention, 'id' | 'ref' | 'adresse' | 'acp_id' | 'created_at'>;
  if (!iv.ref) return { ok: false, error: 'Référence intervention manquante.' };

  // Adresse pour le nom du dossier Drive : préfère l'ACP (cohérent avec
  // createInterventionFolder côté capture photos), fallback iv.adresse.
  let adresseDossier = iv.adresse ?? '';
  if (iv.acp_id) {
    const { data: acpRow } = await supabase
      .from('acps')
      .select('nom, adresse, code_postal, ville')
      .eq('id', iv.acp_id)
      .maybeSingle();
    const acp = acpRow as Pick<Acp, 'nom' | 'adresse' | 'code_postal' | 'ville'> | null;
    if (acp) {
      const composed = [acp.nom, acp.adresse, acp.code_postal, acp.ville]
        .filter(Boolean)
        .join(' ')
        .trim();
      if (composed) adresseDossier = composed;
    }
  }

  const year = iv.created_at
    ? new Date(iv.created_at).getFullYear()
    : new Date().getFullYear();

  // ── 2. Compte les photos déjà sur Drive (informatif) ────────────────
  const { count: photosCount } = await supabase
    .from('photos_interventions')
    .select('id', { count: 'exact', head: true })
    .eq('intervention_id', interventionId);

  // ── 3. Génère et upload le rapport PDF (si rédigé) ──────────────────
  let rapportUrl: string | undefined;
  const built = await buildRapportPdf(interventionId);
  if (built.ok) {
    const up = await uploadRapport({
      ref: iv.ref,
      adresse: adresseDossier,
      year,
      bytes: new Uint8Array(built.pdfBuffer),
    });
    if (!up.ok) return { ok: false, error: up.error };
    rapportUrl = up.web_view_link;
  } else if (built.error !== 'Aucun rapport rédigé pour cette intervention.') {
    // Erreur autre que "rapport vide" → propage. Le cas "rapport vide"
    // est tolérant : permet de sync les photos même avant la rédaction.
    return { ok: false, error: built.error };
  }

  return {
    ok: true,
    rapport_url: rapportUrl,
    photos_count: photosCount ?? 0,
  };
}
