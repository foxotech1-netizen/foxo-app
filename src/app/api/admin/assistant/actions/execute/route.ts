import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isAdminUser } from '@/lib/auth/server';
import { assignTechnician } from '@/app/admin/actions';
import { notifyOccupantsForIntervention } from '@/lib/occupants/notify-occupants';

export const maxDuration = 60;

// Route d'EXÉCUTION des actions de l'assistant.
// Déclenchée UNIQUEMENT par un clic humain sur le bouton « Exécuter » du front —
// jamais par le modèle. Re-vérifie la garde admin et re-valide les paramètres
// avant toute mutation, puis délègue à l'action canonique existante.

interface ExecuteRequest {
  action?: string;
  params?: Record<string, unknown>;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await isAdminUser())) {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
  }

  let body: ExecuteRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Requête invalide.' }, { status: 400 });
  }

  const action = str(body.action);
  const params = body.params && typeof body.params === 'object' ? (body.params as Record<string, unknown>) : {};

  try {
    switch (action) {
      case 'assign_technician': {
        const interventionId = str(params.interventionId);
        const technicienId = str(params.technicienId);
        if (!interventionId || !technicienId) {
          return NextResponse.json({ ok: false, error: "Paramètres manquants pour l'assignation." }, { status: 400 });
        }
        const res = await assignTechnician(interventionId, technicienId);
        if (res.error) {
          return NextResponse.json({ ok: false, error: res.error }, { status: 400 });
        }
        const techNom = str(params.technicienNom);
        const ref = str(params.interventionRef);
        const message = `Technicien ${techNom} assigné au dossier ${ref || interventionId}.`.replace(/\s+/g, ' ').trim();
        return NextResponse.json({ ok: true, message });
      }
      case 'relance_occupants': {
        const interventionId = str(params.interventionId);
        const rawIds = Array.isArray(params.occupantIds) ? params.occupantIds : [];
        const occupantIds = rawIds.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
        if (!interventionId || occupantIds.length === 0) {
          return NextResponse.json({ ok: false, error: 'Paramètres manquants pour la relance des occupants.' }, { status: 400 });
        }
        const res = await notifyOccupantsForIntervention(interventionId, { occupantIds, sentBy: user.email ?? null });
        if (!res.ok) {
          return NextResponse.json({ ok: false, error: res.error }, { status: res.status ?? 400 });
        }
        const ref = str(params.interventionRef);
        const sent = typeof res.sent === 'number' ? res.sent : occupantIds.length;
        const failed = typeof res.failed === 'number' ? res.failed : 0;
        const message = `Relance envoyée pour le dossier ${ref || interventionId} : ${sent} envoi(s) réussi(s)${failed ? `, ${failed} échec(s)` : ''}.`;
        return NextResponse.json({ ok: true, message });
      }
      case 'planifier_rdv': {
        const interventionId = str(params.interventionId);
        const date = str(params.date);
        const heure = str(params.heure);
        if (!interventionId || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(heure)) {
          return NextResponse.json({ ok: false, error: 'Paramètres manquants ou invalides pour la planification.' }, { status: 400 });
        }
        // Même logique que la route manuelle soeur
        // (src/app/api/admin/interventions/[id]/schedule/route.ts) : pose le créneau
        // et passe en 'attente'. Aucun email, aucun événement agenda.
        const creneauDebutIso = new Date(`${date}T${heure}:00`).toISOString();
        const { error: schedErr } = await supabase
          .from('interventions')
          .update({ creneau_debut: creneauDebutIso, statut: 'attente', updated_at: new Date().toISOString() })
          .eq('id', interventionId);
        if (schedErr) {
          return NextResponse.json({ ok: false, error: schedErr.message }, { status: 500 });
        }
        const ref = str(params.interventionRef);
        const [yy, mm, dd] = date.split('-');
        const message = `Rendez-vous planifié pour le dossier ${ref || interventionId} le ${dd}/${mm}/${yy} à ${heure}. Le dossier est passé en « attente » de confirmation.`;
        return NextResponse.json({ ok: true, message });
      }
      default:
        return NextResponse.json({ ok: false, error: `Action non reconnue : ${action || '(vide)'}.` }, { status: 400 });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erreur inconnue';
    return NextResponse.json({ ok: false, error: 'Exécution : ' + msg }, { status: 500 });
  }
}
