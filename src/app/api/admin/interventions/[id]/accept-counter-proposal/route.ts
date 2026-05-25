import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdminUser } from "@/lib/auth/server";
import { sendEmail } from '@/lib/gmail';
import { sendSMS, sendWhatsApp, logSmsSend } from '@/lib/sms';
import { updateCalendarEvent } from '@/lib/google-calendar';
import type { ContactPreference } from '@/lib/types/database';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface PostBody {
  occupant_id?: unknown;
}

interface OccupantRow {
  id: string;
  intervention_id: string;
  appartement: string | null;
  prenom: string | null;
  nom: string | null;
  email: string | null;
  telephone: string | null;
  contact_preference: ContactPreference | null;
  proposed_creneau_debut: string | null;
  proposed_creneau_fin: string | null;
}

function fmtDateTimeFr(iso: string): string {
  return new Date(iso).toLocaleString('fr-BE', {
    weekday: 'long', day: 'numeric', month: 'long',
    hour: '2-digit', minute: '2-digit',
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]!));
}

function buildAcceptedEmail(args: {
  prenom: string;
  startIso: string;
  endIso: string | null;
}): string {
  const dateStr = fmtDateTimeFr(args.startIso);
  const endStr = args.endIso ? ` (jusqu'à ${new Date(args.endIso).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })})` : '';
  return `<!DOCTYPE html><html><body style="margin:0;background:#F5F2EC;font-family:'DM Sans',Arial,sans-serif;color:#1C1A16">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F2EC;padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#FDFBF7;border-radius:16px;border:1px solid #DDD8CC;padding:32px">
        <tr><td>
          <div style="font-size:24px;font-weight:800;color:#1B3A6B;letter-spacing:.02em">FoxO</div>
          <div style="font-size:11px;color:#A09A8E;text-transform:uppercase;letter-spacing:.1em;margin-top:2px">Proposition acceptée</div>
          <div style="height:1px;background:#DDD8CC;margin:24px 0"></div>
          <p style="font-size:14px;line-height:1.6;margin:0 0 16px">Bonjour ${escapeHtml(args.prenom)},</p>
          <p style="font-size:14px;line-height:1.6;margin:0 0 16px">
            Bonne nouvelle : le créneau que vous avez proposé a été <strong>accepté</strong>.
          </p>
          <p style="font-size:14px;line-height:1.6;margin:0 0 16px">
            L'intervention FoxO est désormais planifiée le <strong>${escapeHtml(dateStr)}</strong>${escapeHtml(endStr)}.
          </p>
          <p style="font-size:13px;color:#6B6558;line-height:1.6;margin:20px 0 0">
            Merci de votre disponibilité — à bientôt !
          </p>
          <div style="height:1px;background:#DDD8CC;margin:24px 0"></div>
          <p style="font-size:11px;color:#A09A8E;line-height:1.6;margin:0">Fox Group SRL — Détection de fuites non destructive — Belgique</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await isAdminUser())) {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
  }
  const { id: interventionId } = await params;

  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return NextResponse.json({ ok: false, error: 'Body JSON invalide.' }, { status: 400 });
  }
  const occupantId = typeof body.occupant_id === 'string' ? body.occupant_id : '';
  if (!occupantId) {
    return NextResponse.json({ ok: false, error: 'occupant_id requis.' }, { status: 400 });
  }

  const admin = createAdminClient();

  // Charge l'occupant + vérifie qu'il appartient bien à l'intervention
  // et qu'il a une contre-proposition valide.
  const { data: occData, error: occErr } = await admin
    .from('occupants')
    .select('id, intervention_id, appartement, prenom, nom, email, telephone, contact_preference, proposed_creneau_debut, proposed_creneau_fin')
    .eq('id', occupantId)
    .maybeSingle();
  if (occErr) return NextResponse.json({ ok: false, error: occErr.message }, { status: 500 });
  if (!occData) return NextResponse.json({ ok: false, error: 'Occupant introuvable.' }, { status: 404 });
  const occ = occData as OccupantRow;

  if (occ.intervention_id !== interventionId) {
    return NextResponse.json({ ok: false, error: 'Cet occupant n\'appartient pas à cette intervention.' }, { status: 400 });
  }
  if (!occ.proposed_creneau_debut) {
    return NextResponse.json({ ok: false, error: 'Aucune contre-proposition à accepter.' }, { status: 400 });
  }

  const newStartIso = occ.proposed_creneau_debut;
  const newEndIso = occ.proposed_creneau_fin;
  const nowIso = new Date().toISOString();

  // 1. Update intervention : nouveau creneau_debut, statut → confirmee
  //    (accepter une contre-proposition implique que le syndic/admin a
  //    validé le RDV).
  const { error: ivErr } = await admin
    .from('interventions')
    .update({
      creneau_debut: newStartIso,
      statut: 'confirmee',
      updated_at: nowIso,
    })
    .eq('id', interventionId);
  if (ivErr) return NextResponse.json({ ok: false, error: ivErr.message }, { status: 500 });

  // 2. Update occupant : conf=confirme, clear proposed_*
  const { error: occUpdErr } = await admin
    .from('occupants')
    .update({
      conf: 'confirme',
      confirmed_at: nowIso,
      proposed_creneau_debut: null,
      proposed_creneau_fin: null,
    })
    .eq('id', occupantId);
  if (occUpdErr) return NextResponse.json({ ok: false, error: occUpdErr.message }, { status: 500 });

  // 3. Log d'audit (best-effort)
  await admin.from('occupant_responses_log').insert({
    occupant_id: occupantId,
    intervention_id: interventionId,
    reponse: 'confirme',
    note: `Contre-proposition acceptée par l'admin (${user.email ?? 'admin'}).`,
  }).then((r) => {
    if (r.error) console.warn('[accept-counter] log insert failed:', r.error.message);
  });

  // 4. Sync Google Calendar (best-effort) — on cherche un creneau lié
  //    à cette intervention qui a un google_event_id, et on le PATCH
  //    avec les nouvelles bornes. On met aussi à jour la ligne
  //    creneaux_disponibles (date/heure_debut/heure_fin) pour cohérence
  //    du planning.
  let calendarSync: { ok: boolean; error?: string } = { ok: false, error: 'no event' };
  try {
    const { data: creneau } = await admin
      .from('creneaux_disponibles')
      .select('id, google_event_id')
      .eq('intervention_id', interventionId)
      .maybeSingle();

    const start = new Date(newStartIso);
    const date = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
    const heureDebut = `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`;
    const heureFin = newEndIso
      ? (() => {
          const e = new Date(newEndIso);
          return `${String(e.getHours()).padStart(2, '0')}:${String(e.getMinutes()).padStart(2, '0')}`;
        })()
      : null;

    if (creneau?.id) {
      await admin
        .from('creneaux_disponibles')
        .update({
          date,
          heure_debut: heureDebut,
          ...(heureFin ? { heure_fin: heureFin } : {}),
        })
        .eq('id', creneau.id);
    }

    if (creneau?.google_event_id) {
      const res = await updateCalendarEvent(creneau.google_event_id, {
        startIso: newStartIso,
        endIso: newEndIso ?? undefined,
      });
      calendarSync = res.ok ? { ok: true } : { ok: false, error: res.error };
      if (!res.ok) console.warn('[accept-counter] calendar update failed:', res.error);
    }
  } catch (e) {
    console.warn('[accept-counter] calendar sync threw:', e);
    calendarSync = { ok: false, error: e instanceof Error ? e.message : 'unknown' };
  }

  // 5. Notification occupant (best-effort, multicanal selon préférence)
  const notifs: Array<{ channel: 'email' | 'sms' | 'whatsapp'; ok: boolean; error?: string }> = [];
  const prenom = occ.prenom ?? '';
  const fullName = [occ.prenom, occ.nom].filter(Boolean).join(' ') || 'Occupant';
  const pref: ContactPreference = occ.contact_preference ?? 'email';
  const channels: ('email' | 'sms' | 'whatsapp')[] =
    pref === 'both' ? ['email', 'sms']
    : pref === 'email' ? ['email']
    : pref === 'sms' ? ['sms']
    : ['whatsapp'];

  const dateFr = fmtDateTimeFr(newStartIso);
  const smsMessage = `Bonjour ${prenom}, votre proposition a été acceptée. L'intervention FoxO est planifiée le ${dateFr}. À bientôt.`;

  for (const ch of channels) {
    try {
      if (ch === 'email') {
        if (!occ.email) { notifs.push({ channel: 'email', ok: false, error: 'pas d\'email' }); continue; }
        const html = buildAcceptedEmail({ prenom, startIso: newStartIso, endIso: newEndIso });
        const r = await sendEmail({
          to: occ.email,
          subject: 'FoxO — Votre créneau a été accepté',
          html,
        });
        notifs.push({ channel: 'email', ok: r.ok, error: r.ok ? undefined : r.error });
      } else {
        if (!occ.telephone) { notifs.push({ channel: ch, ok: false, error: 'pas de téléphone' }); continue; }
        const r = ch === 'whatsapp' ? await sendWhatsApp(occ.telephone, smsMessage) : await sendSMS(occ.telephone, smsMessage);
        await logSmsSend({
          intervention_id: interventionId,
          occupant_id: occupantId,
          to_phone: occ.telephone,
          channel: ch,
          message: smsMessage,
          result: r,
          sent_by: user.email ?? 'admin',
        });
        notifs.push({ channel: ch, ok: r.ok, error: r.ok ? undefined : r.error });
      }
    } catch (e) {
      notifs.push({ channel: ch, ok: false, error: e instanceof Error ? e.message : 'unknown' });
    }
  }

  return NextResponse.json({
    ok: true,
    intervention: {
      id: interventionId,
      creneau_debut: newStartIso,
      statut: 'confirmee',
    },
    occupant: {
      id: occupantId,
      conf: 'confirme',
      confirmed_at: nowIso,
      appartement: occ.appartement,
      fullName,
    },
    calendarSync,
    notifs,
  });
}
