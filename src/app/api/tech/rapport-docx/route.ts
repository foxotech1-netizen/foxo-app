import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { roleForEmail } from '@/lib/auth/roles';
import { buildRapportDocx } from '@/lib/rapport/build-docx';
import { uploadRapport } from '@/lib/google-drive';
import type { Acp, Intervention, Organisation, Rapport } from '@/lib/types/database';

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
  const { data: { user } } = await supabase.auth.getUser();
  // Autorise les techs whitelist (TECH_EMAILS), les admins, et tout
  // utilisateur dont la row utilisateurs porte role = 'technicien'
  // (techs créés en DB sans être hardcodés dans roles.ts).
  const role = roleForEmail(user?.email);
  const isTech = role === 'tech' || role === 'admin';
  const isTechDB = user
    ? await supabase
        .from('utilisateurs')
        .select('id')
        .eq('email', (user.email ?? '').toLowerCase())
        .eq('role', 'technicien')
        .maybeSingle()
        .then((r) => !!r.data)
    : false;
  if (!user || (!isTech && !isTechDB)) {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
  }

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

  // Ownership : tech connecté = technicien_id de l'intervention
  const { data: techRow } = await supabase
    .from('utilisateurs')
    .select('id')
    .eq('email', (user.email ?? '').toLowerCase())
    .maybeSingle();
  if (!techRow) return NextResponse.json({ ok: false, error: 'Tech inconnu.' }, { status: 403 });

  const { data: ivData } = await supabase
    .from('interventions')
    .select('*')
    .eq('id', interventionId)
    .maybeSingle();
  if (!ivData) return NextResponse.json({ ok: false, error: 'Intervention introuvable.' }, { status: 404 });
  const iv = ivData as Intervention;
  if (iv.technicien_id !== techRow.id) {
    return NextResponse.json(
      { ok: false, error: 'Intervention non assignée.' },
      { status: 403 },
    );
  }

  // Charge ACP + rapport + syndic en parallèle
  const [acpRes, rapRes, orgRes] = await Promise.all([
    iv.acp_id
      ? supabase.from('acps').select('*').eq('id', iv.acp_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from('rapports').select('*').eq('intervention_id', iv.id).maybeSingle(),
    iv.syndic_id
      ? supabase.from('organisations').select('nom, adresse, email').eq('id', iv.syndic_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const acp = acpRes.data as Acp | null;
  const rapport = rapRes.data as Rapport | null;
  const syndic = orgRes.data as Pick<Organisation, 'nom' | 'adresse' | 'email'> | null;

  // Charge les observations terrain (techniques + tests menés sur site)
  const obsRes = await supabase
    .from('observations_terrain')
    .select('test_type, etage, localisation, notes')
    .eq('intervention_id', iv.id)
    .order('created_at', { ascending: true });
  const observations = (obsRes.data ?? []) as Array<{
    test_type: string;
    etage: string | null;
    localisation: string | null;
    notes: string | null;
  }>;

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
  const acpAdresse = [acp?.adresse, acp?.code_postal, acp?.ville].filter(Boolean).join(', ') || '—';

  // ─── Composition des champs du tableau d'identification ──────────────

  const refSyndic = (iv.reference_externe ?? '').trim() || null;

  // Description : préfère interventions.description complète, sinon 1ère
  // ligne de la section Dégâts (200 chars max) en fallback.
  const description = iv.description?.trim()
    || sections.degats?.split(/\r?\n/)[0]?.slice(0, 200)
    || '—';

  // Adresse Facturation : nom (iv.nom_facturation prioritaire, sinon
  // syndic.nom), adresse syndic, email (iv.email_facturation prioritaire,
  // sinon syndic.email), BCE intervention si présent.
  const factuLines: string[] = [];
  const factuName = iv.nom_facturation || syndic?.nom;
  if (factuName) factuLines.push(factuName);
  if (syndic?.adresse) factuLines.push(syndic.adresse);
  const factuEmail = iv.email_facturation || syndic?.email;
  if (factuEmail) factuLines.push(factuEmail);
  if (iv.bce_facturation) factuLines.push(`BCE : ${iv.bce_facturation}`);
  const adresseFacturation = factuLines.length > 0 ? factuLines.join('\n') : '—';

  // Adresse d'intervention : ACP nom + adresse complète + étages distincts
  // collectés depuis les observations_terrain. Fallback sur iv.adresse si
  // pas d'ACP rattachée.
  const intervLines: string[] = [];
  if (acp?.nom) intervLines.push(acp.nom);
  if (acpAdresse !== '—') intervLines.push(acpAdresse);
  const etagesSet = new Set(
    observations.map((o) => o.etage).filter((e): e is string => Boolean(e)),
  );
  if (etagesSet.size > 0) {
    intervLines.push(`Étages : ${[...etagesSet].sort().join(', ')}`);
  }
  const adresseIntervention = intervLines.length > 0
    ? intervLines.join('\n')
    : (iv.adresse ?? '—');

  // Génération du .docx (template FoxO complet : photos par section,
  // header logo, encadré 4 côtés, etc. cf. lib/rapport/build-docx.ts)
  const docxBytes = await buildRapportDocx({
    interventionId: iv.id,
    ref,
    refSyndic,
    description,
    adresseFacturation,
    adresseIntervention,
    date: new Date(),
    sections,
    observations,
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
