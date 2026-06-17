import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isAdminUser } from '@/lib/auth/server';
import { assignTechnician, validateRapport, resendRapportToSyndic } from '@/app/admin/actions';
import { notifyOccupantsForIntervention } from '@/lib/occupants/notify-occupants';
import { createCalendarEvent } from '@/lib/google-calendar';
import { createGmailDraft } from '@/lib/gmail';

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
      case 'valider_rapport': {
        const interventionId = str(params.interventionId);
        if (!interventionId) {
          return NextResponse.json({ ok: false, error: 'Paramètre manquant pour la validation du rapport.' }, { status: 400 });
        }
        const res = await validateRapport(interventionId);
        if (!res.ok) {
          return NextResponse.json({ ok: false, error: res.error ?? 'Échec de la validation du rapport.' }, { status: 400 });
        }
        const ref = str(params.interventionRef);
        const message = `Rapport du dossier ${ref || interventionId} validé. Il peut maintenant être transmis au syndic.`;
        return NextResponse.json({ ok: true, message });
      }
      case 'transmettre_rapport': {
        const interventionId = str(params.interventionId);
        if (!interventionId) {
          return NextResponse.json({ ok: false, error: 'Paramètre manquant pour la transmission du rapport.' }, { status: 400 });
        }
        // Re-vérification serveur du statut juste avant l'envoi réel : barrière
        // anti-double-envoi / anti-brouillon. dispatchRapportToSyndic n'impose
        // aucune précondition de statut en interne, donc on la pose ici.
        const { data: rapData } = await supabase
          .from('rapports')
          .select('statut')
          .eq('intervention_id', interventionId)
          .maybeSingle();
        const statut = (rapData as { statut: string | null } | null)?.statut ?? null;
        if (statut !== 'valide') {
          return NextResponse.json(
            { ok: false, error: `Transmission impossible : le rapport doit être au statut « validé » (statut actuel : « ${statut ?? 'inconnu'} »).` },
            { status: 409 },
          );
        }
        const res = await resendRapportToSyndic(interventionId);
        if (!('ok' in res) || res.ok !== true) {
          return NextResponse.json({ ok: false, error: res.error ?? 'Échec de la transmission du rapport.' }, { status: 400 });
        }
        const ref = str(params.interventionRef);
        const message = `Rapport du dossier ${ref || interventionId} transmis au syndic.`;
        return NextResponse.json({ ok: true, message });
      }
      case 'creer_evenement_agenda': {
        const titre = str(params.titre);
        const date = str(params.date);
        const heure = str(params.heure);
        const dureeRaw = typeof params.duree === 'number' ? params.duree : Number(params.duree);
        const duree = Number.isFinite(dureeRaw) && dureeRaw > 0 ? Math.round(dureeRaw) : 60;
        const description = str(params.description);
        const lieu = str(params.lieu);
        if (!titre || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(heure)) {
          return NextResponse.json({ ok: false, error: "Paramètres manquants ou invalides pour l'événement agenda." }, { status: 400 });
        }
        const startIso = `${date}T${heure}:00`;
        const startUtc = new Date(`${date}T${heure}:00Z`);
        const endUtc = new Date(startUtc.getTime() + duree * 60000);
        const p2 = (n: number) => String(n).padStart(2, '0');
        const endIso = `${endUtc.getUTCFullYear()}-${p2(endUtc.getUTCMonth() + 1)}-${p2(endUtc.getUTCDate())}T${p2(endUtc.getUTCHours())}:${p2(endUtc.getUTCMinutes())}:00`;
        const res = await createCalendarEvent({
          startIso,
          endIso,
          summary: titre,
          description: description || undefined,
          location: lieu || undefined,
        });
        if (!res.ok) {
          return NextResponse.json({ ok: false, error: res.error }, { status: 400 });
        }
        const [yy, mm, dd] = date.split('-');
        const message = `Événement « ${titre} » créé dans l'agenda le ${dd}/${mm}/${yy} à ${heure}.`;
        return NextResponse.json({ ok: true, message });
      }
      case 'brouillon_reponse_mail': {
        const mailId = str(params.mailId);
        const body2 = str(params.body);
        const to = str(params.to);
        const subject = str(params.subject);
        if (!mailId || !body2) {
          return NextResponse.json({ ok: false, error: 'Paramètres manquants pour le brouillon de réponse.' }, { status: 400 });
        }
        const res = await createGmailDraft({
          mailId,
          body: body2,
          to: to || undefined,
          subject: subject || undefined,
        });
        if (!res.ok) {
          return NextResponse.json({ ok: false, error: res.error }, { status: 400 });
        }
        const message = `Brouillon de réponse créé dans Gmail. Relis-le et envoie-le depuis tes Brouillons : ${res.gmail_url}`;
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
