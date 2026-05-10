// GET /api/admin/mails/analyses?thread_ids=tid1,tid2,...
// Réponse : { success: true, analyses: Record<thread_id, MailAnalyseEnriched> }
//
// Lecture batch des analyses Claude pour le mount du composant
// MailsClient — évite N requêtes individuelles par thread visible.
//
// Enrichissement côté serveur :
//   - dossier { id, ref, adresse } via JOIN interventions
//   - creneau { date, heure_debut, heure_fin, technicien_nom } via JOIN
//     creneaux_disponibles + utilisateurs
//
// Évite N + N call client. Volume attendu : 30-50 mails par mount,
// donc ≤3 requêtes Supabase (analyses + dossiers concernés + créneaux
// concernés).

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { roleForEmail } from '@/lib/auth/roles';

export const dynamic = 'force-dynamic';

interface AnalyseRow {
  thread_id: string;
  type: string | null;
  urgence: boolean | null;
  langue: string | null;
  adresse_extraite: string | null;
  numero_dossier_mentionne: string | null;
  resume: string | null;
  occupant_telephone: string | null;
  occupant_email: string | null;
  dossier_match_id: string | null;
  creneau_propose_id: string | null;
  fenetre_etendue: boolean | null;
  pj_drive_ids: string[] | null;
  brouillon_gmail_id: string | null;
  event_calendar_id: string | null;
  errors: string[] | null;
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || roleForEmail(user.email) !== 'admin') {
    return NextResponse.json({ success: false, error: 'Accès refusé.' }, { status: 401 });
  }

  const url = new URL(request.url);
  const raw = url.searchParams.get('thread_ids') ?? '';
  const ids = raw.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 200);
  if (ids.length === 0) return NextResponse.json({ success: true, analyses: {} });

  const admin = createAdminClient();

  const { data: analyses, error } = await admin
    .from('mails_analyses')
    .select('thread_id, type, urgence, langue, adresse_extraite, numero_dossier_mentionne, resume, occupant_telephone, occupant_email, dossier_match_id, creneau_propose_id, fenetre_etendue, pj_drive_ids, brouillon_gmail_id, event_calendar_id, errors')
    .in('thread_id', ids);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  const rows = (analyses ?? []) as AnalyseRow[];

  // Batch lookups dossiers + créneaux pour éviter N+1.
  const dossierIds = Array.from(new Set(rows.map((r) => r.dossier_match_id).filter((x): x is string => !!x)));
  const creneauIds = Array.from(new Set(rows.map((r) => r.creneau_propose_id).filter((x): x is string => !!x)));

  const dossierMap = new Map<string, { id: string; ref: string | null; adresse: string | null }>();
  if (dossierIds.length > 0) {
    const { data: dossiers } = await admin
      .from('interventions')
      .select('id, ref, adresse')
      .in('id', dossierIds);
    for (const d of (dossiers ?? []) as { id: string; ref: string | null; adresse: string | null }[]) {
      dossierMap.set(d.id, d);
    }
  }

  // Créneaux + tech (en 2 requêtes : creneaux puis utilisateurs)
  const creneauMap = new Map<string, { date: string; heure_debut: string; heure_fin: string; technicien_id: string | null }>();
  const techIds: Set<string> = new Set();
  if (creneauIds.length > 0) {
    const { data: creneaux } = await admin
      .from('creneaux_disponibles')
      .select('id, date, heure_debut, heure_fin, technicien_id')
      .in('id', creneauIds);
    for (const c of (creneaux ?? []) as { id: string; date: string; heure_debut: string; heure_fin: string; technicien_id: string | null }[]) {
      creneauMap.set(c.id, c);
      if (c.technicien_id) techIds.add(c.technicien_id);
    }
  }
  const techMap = new Map<string, string>();
  if (techIds.size > 0) {
    const { data: techs } = await admin
      .from('utilisateurs')
      .select('id, prenom, nom')
      .in('id', Array.from(techIds));
    for (const t of (techs ?? []) as { id: string; prenom: string | null; nom: string | null }[]) {
      const nm = [t.prenom, t.nom].filter(Boolean).join(' ').trim() || 'Tech';
      techMap.set(t.id, nm);
    }
  }

  const result: Record<string, unknown> = {};
  for (const r of rows) {
    const dossier = r.dossier_match_id ? dossierMap.get(r.dossier_match_id) ?? null : null;
    const creneauRow = r.creneau_propose_id ? creneauMap.get(r.creneau_propose_id) ?? null : null;
    const creneau = creneauRow
      ? {
          date: creneauRow.date,
          heure_debut: creneauRow.heure_debut.slice(0, 5),
          heure_fin: creneauRow.heure_fin.slice(0, 5),
          technicien_nom: creneauRow.technicien_id ? techMap.get(creneauRow.technicien_id) ?? '?' : '?',
        }
      : null;
    result[r.thread_id] = { ...r, dossier, creneau };
  }

  return NextResponse.json({ success: true, analyses: result });
}
