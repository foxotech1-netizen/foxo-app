import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getCurrentTech, verifyTechOwnsIntervention, techError } from '@/lib/auth/tech-helpers';
import { buildRapportDocx, type ReportData } from '@/lib/rapport/build-docx';
import { uploadRapport } from '@/lib/google-drive';
import type { Acp, Intervention, Occupant, Organisation, Rapport } from '@/lib/types/database';
import {
  buildObjet,
  buildFacturationLines,
  buildAdresseInterventionLine1,
  buildAdresseInterventionLine2,
  buildRefLabelValue,
  buildTechniques,
  fmtDateShort,
  fmtDateIsoToShort,
} from '@/lib/rapport/report-data-mapping';
import { techniquesFromKeys } from '@/lib/rapport/techniques';

function fmtDate(d: Date): string {
  return fmtDateShort(d);
}

export const dynamic = 'force-dynamic';

// POST /api/tech/rapport-docx
//
// Body : { intervention_id: string }
//
// Génère le rapport Word brouillon (template FoxO Rapport v3) et
// l'upload sur Drive dans RAPPORTS/{year}/{ref} {acp_nom}/. Sert
// au technicien à exporter une version éditable du rapport en cours
// avant publication. Idempotent : à chaque appel le .docx existant
// est écrasé.
//
// Sécurité : tech connecté + ownership intervention (technicien_id).
export async function POST(request: Request) {
  const supabase = await createClient();
  const tech = await getCurrentTech(supabase);
  if (!tech.ok) return techError(tech);

  let body: { intervention_id?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'Body JSON invalide.' }, { status: 400 });
  }
  const interventionId = typeof body.intervention_id === 'string' ? body.intervention_id : null;
  if (!interventionId) {
    return NextResponse.json({ ok: false, error: 'intervention_id requis.' }, { status: 400 });
  }

  // Ownership : tech connecté = technicien_id de l'intervention.
  // select '*' + splitNotFound pour conserver le 404 'Intervention
  // introuvable.' distinct du 403 'Intervention non assignée.'.
  const owns = await verifyTechOwnsIntervention(supabase, tech.tech.id, interventionId, {
    select: '*',
    splitNotFound: true,
  });
  if (!owns.ok) return techError(owns);
  const iv = owns.intervention as unknown as Intervention;

  // Charge ACP + rapport + syndic + occupants + observations en parallèle.
  // Colonnes étendues pour le mapping rapport modèle 2026-101 :
  //   - acp.bce         : BCE de l'ACP pour la ligne 1 facturation
  //   - syndic.bce/contact : "c/o {nom}  –  {contact}" en ligne 2
  //   - occupant.prenom + type_occupant : "Apt X : Prénom Nom (type)"
  const [acpRes, rapRes, orgRes, occRes, obsRes] = await Promise.all([
    iv.acp_id
      ? supabase.from('acps').select('*').eq('id', iv.acp_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from('rapports').select('*').eq('intervention_id', iv.id).maybeSingle(),
    iv.syndic_id
      ? supabase.from('organisations').select('nom, adresse, email, contact, bce').eq('id', iv.syndic_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from('occupants')
      .select('appartement, prenom, nom, type_occupant')
      .eq('intervention_id', iv.id)
      .order('appartement', { ascending: true }),
    supabase.from('observations_terrain')
      .select('test_type')
      .eq('intervention_id', iv.id)
      .order('created_at', { ascending: true }),
  ]);
  const acp = acpRes.data as Acp | null;
  const rapport = rapRes.data as Rapport | null;
  const syndic = orgRes.data as Pick<Organisation, 'nom' | 'adresse' | 'email' | 'contact' | 'bce'> | null;
  const occupants = (occRes.data ?? []) as Pick<Occupant, 'appartement' | 'prenom' | 'nom' | 'type_occupant'>[];
  const observations = (obsRes.data ?? []) as Array<{ test_type: string }>;

  // Au moins une section non vide pour exporter (sinon le .docx est creux)
  const sections = {
    degats: rapport?.degats ?? '',
    inspection: rapport?.inspection ?? '',
    conclusion: rapport?.conclusion ?? '',
    recommandations: rapport?.recommandations ?? '',
  };
  const hasContent = Object.values(sections).some((s) => s.trim().length > 0);
  if (!hasContent) {
    return NextResponse.json({ ok: false, error: 'Aucun contenu à exporter.' }, { status: 400 });
  }

  const ref = iv.ref ?? '—';
  const acpNom = acp?.nom ?? '—';

  // ─── Composition ReportData (template FOXO_BASE) ────────────────────
  //
  // Les helpers (lib/rapport/report-data-mapping.ts) sont partagés avec
  // dispatch.ts pour garantir un mapping identique entre l'export
  // brouillon (ce route) et l'envoi final au syndic.

  const today = new Date();

  // Le builder splitte sur '||PARA||' pour produire un Paragraph par bloc
  // (cf. textToParas dans build-docx.ts). On convertit les double-saut-
  // ligne (convention de l'IA + saisie clavier) en ce séparateur.
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
    degats: toParaFmt(sections.degats),
    inspection: toParaFmt(sections.inspection),
    conclusion: toParaFmt(sections.conclusion),
    recommandation: toParaFmt(sections.recommandations),
    fait_a_date: rapport?.date_rapport ? fmtDateIsoToShort(rapport.date_rapport) : fmtDate(today),
  };

  // Génération du .docx selon le template FoxO complet (photos par section,
  // header logo, encadré 4 côtés, footer 3 lignes — cf. build-docx.ts).
  const docxBytes = await buildRapportDocx({
    interventionId: iv.id,
    data: reportData,
    date: today,
  });

  // Upload sur Drive en best-effort (archivage). On `await` pour rester
  // dans la durée de vie de la lambda, mais on ignore le résultat —
  // l'export client ne doit pas échouer si Drive est indisponible.
  const adresseFolder = acpNom;
  const year = new Date().getFullYear();
  const filename = `${ref} ${adresseFolder}.docx`;
  try {
    await uploadRapport({
      ref,
      adresse: adresseFolder,
      year,
      bytes: docxBytes,
      filename,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
  } catch (e) {
    console.warn('[rapport-docx] uploadRapport Drive skipped:', e);
  }

  // Téléchargement HTTP direct du .docx — le client utilise un blob +
  // anchor download pour déclencher la sauvegarde locale chez le tech.
  // Cast en BodyInit : Uint8Array est accepté par Response à l'exécution
  // mais le typage Next/lib.dom hésite avec ArrayBufferLike.
  return new NextResponse(docxBytes as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
      'Content-Length': String(docxBytes.length),
    },
  });
}
