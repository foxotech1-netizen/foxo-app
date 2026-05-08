import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { roleForEmail } from '@/lib/auth/roles';
import { buildRapportDocx, type ReportData, type ReportTechniques } from '@/lib/rapport/build-docx';
import { uploadRapport } from '@/lib/google-drive';
import type { Acp, Intervention, Occupant, Organisation, Rapport } from '@/lib/types/database';

function fmtDate(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

// Mappe les test_type observations → 8 booleans techniques du template.
// Accepte les anciennes valeurs ('Mise en pression', 'Humidimètre') ET les
// nouvelles (post-vocab alignment commit 7514a08) pour rétro-compat.
function buildTechniques(observations: Array<{ test_type: string }>): ReportTechniques {
  const types = new Set(observations.map((o) => o.test_type));
  return {
    capteur:    types.has("Capteur d'humidité") || types.has('Humidimètre'),
    thermique:  types.has('Thermographie'),
    camera:     types.has('Caméra endoscopique'),
    traceur:    types.has('Test colorant'),
    acoustique: types.has('Détection acoustique'),
    pression:   types.has('Test de pression') || types.has('Mise en pression'),
    gaz:        types.has('Gaz traceur'),
    visuelle:   types.has('Inspection visuelle'),
  };
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

  // Charge ACP + rapport + syndic + occupants + observations en parallèle
  const [acpRes, rapRes, orgRes, occRes, obsRes] = await Promise.all([
    iv.acp_id
      ? supabase.from('acps').select('*').eq('id', iv.acp_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from('rapports').select('*').eq('intervention_id', iv.id).maybeSingle(),
    iv.syndic_id
      ? supabase.from('organisations').select('nom, adresse, email').eq('id', iv.syndic_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from('occupants')
      .select('appartement, nom')
      .eq('intervention_id', iv.id)
      .order('appartement', { ascending: true }),
    supabase.from('observations_terrain')
      .select('test_type')
      .eq('intervention_id', iv.id)
      .order('created_at', { ascending: true }),
  ]);
  const acp = acpRes.data as Acp | null;
  const rapport = rapRes.data as Rapport | null;
  const syndic = orgRes.data as Pick<Organisation, 'nom' | 'adresse' | 'email'> | null;
  const occupants = (occRes.data ?? []) as Pick<Occupant, 'appartement' | 'nom'>[];
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
  const acpAdresse = [acp?.adresse, acp?.code_postal, acp?.ville].filter(Boolean).join(', ');

  // ─── Composition ReportData (template FOXO_BASE) ────────────────────

  const today = new Date();
  const refExterne = (iv.reference_externe ?? '').trim();

  // Le builder splitte sur '||PARA||' pour produire un Paragraph par bloc
  // (cf. textToParas dans build-docx.ts). On convertit les double-saut-
  // ligne (convention de l'IA + saisie clavier) en ce séparateur.
  const toParaFmt = (s: string) => (s ?? '').replace(/\n\n/g, '||PARA||');

  // adresse_ligne1 : ACP nom + adresse séparés par '  –  '. Fallback iv.adresse.
  const adresseLigne1 = [acp?.nom, acpAdresse]
    .filter((v): v is string => Boolean(v && v.trim()))
    .join('  –  ') || (iv.adresse ?? '');

  // adresse_ligne2 : occupants formatés "Apt X – Nom" séparés par '  –  '.
  const adresseLigne2 = occupants
    .map((o) => {
      const apt = o.appartement?.trim();
      const nm = o.nom?.trim();
      if (apt && nm) return `Apt ${apt} – ${nm}`;
      if (apt) return `Apt ${apt}`;
      if (nm) return nm;
      return null;
    })
    .filter((s): s is string => s !== null)
    .join('  –  ');

  const reportData: ReportData = {
    numero: ref,
    ref_label: refExterne ? 'Réf. syndic :' : 'Date intervention :',
    ref_value: refExterne || fmtDate(today),
    objet: iv.description || '—',
    facturation_ligne1: iv.nom_facturation || syndic?.nom || '',
    facturation_ligne2: syndic?.adresse || '',
    facturation_ligne3: iv.email_facturation || syndic?.email || '',
    facturation_ligne4: iv.bce_facturation ? `BCE : ${iv.bce_facturation}` : '',
    adresse_ligne1: adresseLigne1,
    adresse_ligne2: adresseLigne2,
    adresse_ligne3: '',
    techniques: buildTechniques(observations),
    degats: toParaFmt(sections.degats),
    inspection: toParaFmt(sections.inspection),
    conclusion: toParaFmt(sections.conclusion),
    recommandation: toParaFmt(sections.recommandations),
    fait_a_date: fmtDate(today),
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
