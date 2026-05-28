import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdminUser } from "@/lib/auth/server";
import { sendEmailResend } from '@/lib/email/resend';
import type { Delegue, Organisation } from '@/lib/types/database';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function buildHtml(args: {
  prenom: string;
  email: string;
  nomOrg: string;
  portalUrl: string;
}): string {
  return `<!DOCTYPE html><html><body style="margin:0;background:#F5F2EC;font-family:'DM Sans',Arial,sans-serif;color:#1C1A16">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F2EC;padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#FDFBF7;border-radius:16px;border:1px solid #DDD8CC;padding:32px">
        <tr><td>
          <div style="font-size:24px;font-weight:800;color:#1B3A6B;letter-spacing:.02em">FoxO</div>
          <div style="font-size:11px;color:#A09A8E;text-transform:uppercase;letter-spacing:.1em;margin-top:2px">Invitation au portail</div>
          <div style="height:1px;background:#DDD8CC;margin:24px 0"></div>
          <p style="font-size:14px;color:#6B6558;line-height:1.6;margin:0 0 16px">Bonjour ${args.prenom || ''},</p>
          <p style="font-size:14px;color:#1C1A16;line-height:1.6;margin:0 0 16px">
            <strong>${args.nomOrg}</strong> vous a donné accès au portail FoxO.
          </p>
          <p style="font-size:14px;color:#1C1A16;line-height:1.6;margin:0 0 16px">
            Connectez-vous avec votre adresse email :
          </p>
          <div style="background:#EBF2FB;border:1px solid #D6E4F7;border-radius:8px;padding:12px 16px;margin:0 0 20px;font-family:'DM Mono',monospace;font-size:13px;color:#1B3A6B;font-weight:700;text-align:center">
            ${args.email}
          </div>
          <div style="text-align:center;margin:24px 0">
            <a href="${args.portalUrl}" style="display:inline-block;background:#1B3A6B;color:#FFFFFF;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:700;font-size:14px">
              Accéder au portail
            </a>
          </div>
          <p style="font-size:13px;color:#6B6558;line-height:1.6;margin:0 0 16px">
            Lors de votre première connexion, un code temporaire à 6 chiffres vous sera envoyé par email pour confirmer votre identité.
          </p>
          <p style="font-size:12px;color:#A09A8E;line-height:1.6;margin:20px 0 0">
            Si vous n'attendiez pas cet accès, vous pouvez ignorer cet email.
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
  _request: Request,
  { params }: { params: Promise<{ org_id: string; id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await isAdminUser())) {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
  }
  const { org_id, id } = await params;

  const [{ data: del, error: dErr }, { data: org, error: oErr }] = await Promise.all([
    supabase.from('delegues').select('*').eq('id', id).maybeSingle(),
    supabase.from('organisations').select('id, nom').eq('id', org_id).maybeSingle(),
  ]);
  if (dErr) return NextResponse.json({ ok: false, error: dErr.message }, { status: 500 });
  if (!del) return NextResponse.json({ ok: false, error: 'Délégué introuvable.' }, { status: 404 });
  if (oErr) return NextResponse.json({ ok: false, error: oErr.message }, { status: 500 });
  if (!org) return NextResponse.json({ ok: false, error: 'Organisation introuvable.' }, { status: 404 });

  const delegue = del as Delegue;
  const organisation = org as Pick<Organisation, 'id' | 'nom'>;
  const portalUrl = (process.env.NEXT_PUBLIC_PORTAL_URL ?? 'https://portal.foxo.be').replace(/\/$/, '');

  const html = buildHtml({
    prenom: delegue.prenom ?? '',
    email: delegue.email,
    nomOrg: organisation.nom,
    portalUrl,
  });

  const send = await sendEmailResend({
    to: delegue.email,
    subject: `Votre accès au portail FoxO — ${organisation.nom}`,
    html,
  });
  if (!send.ok) {
    return NextResponse.json({ ok: false, error: send.error }, { status: 502 });
  }

  // Met à jour invite_sent_at + log timeline (best-effort)
  const sentAt = new Date().toISOString();
  await supabase.from('delegues').update({ invite_sent_at: sentAt }).eq('id', id);
  try {
    const admin = createAdminClient();
    await admin.from('intervention_timeline').insert({
      intervention_id: null,                 // pas d'intervention liée — log au niveau org
      type: 'delegue_invite',
      message: `Invitation portail envoyée à ${delegue.email} (${organisation.nom})`,
      payload: { organisation_id: org_id, delegue_id: id, email: delegue.email },
      created_by: user.email ?? 'admin',
    });
  } catch { /* noop — timeline est best-effort */ }

  return NextResponse.json({ ok: true, invite_sent_at: sentAt });
}
