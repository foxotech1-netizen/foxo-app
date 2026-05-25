import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdminUser } from "@/lib/auth/server";
import { sendEmail } from '@/lib/gmail';
import { getEmailForDoc } from '@/lib/notifications';
import type { Acp, Intervention, Organisation, ParticulierContact, Utilisateur } from '@/lib/types/database';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function buildHtml(args: {
  prenom: string;
  ref: string;
  date: string;
  heure: string;
  adresse: string;
  technicienNom: string;
  type: string;
}): string {
  return `<!DOCTYPE html><html><body style="margin:0;background:#F5F2EC;font-family:'DM Sans',Arial,sans-serif;color:#1C1A16">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F2EC;padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#FDFBF7;border-radius:16px;border:1px solid #DDD8CC;padding:32px">
        <tr><td>
          <div style="font-size:24px;font-weight:800;color:#1B3A6B;letter-spacing:.02em">FoxO</div>
          <div style="font-size:11px;color:#A09A8E;text-transform:uppercase;letter-spacing:.1em;margin-top:2px">Confirmation d'intervention</div>
          <div style="height:1px;background:#DDD8CC;margin:24px 0"></div>
          <p style="font-size:14px;color:#6B6558;line-height:1.6;margin:0 0 16px">Bonjour ${args.prenom || ''},</p>
          <p style="font-size:14px;color:#1C1A16;line-height:1.6;margin:0 0 24px">
            Votre demande d'intervention FoxO est confirmée. Voici le récapitulatif :
          </p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EBF2FB;border:1px solid #D6E4F7;border-radius:12px;padding:16px;margin-bottom:20px">
            <tr><td style="font-size:13px;color:#1B3A6B;line-height:2">
              <strong>Référence :</strong> <span style="font-family:'DM Mono',monospace">${args.ref}</span><br/>
              <strong>Type :</strong> ${args.type}<br/>
              <strong>Date :</strong> ${args.date}<br/>
              <strong>Heure :</strong> ${args.heure}<br/>
              <strong>Adresse :</strong> ${args.adresse}<br/>
              ${args.technicienNom ? `<strong>Technicien :</strong> ${args.technicienNom}<br/>` : ''}
            </td></tr>
          </table>
          <p style="font-size:13px;color:#6B6558;line-height:1.6;margin:0 0 16px">
            Notre équipe vous contactera la veille pour confirmer l'horaire. Si vous devez reporter, répondez simplement à ce mail.
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
  const { id } = await params;

  const { data: iv, error: ivErr } = await supabase
    .from('interventions')
    .select(`
      *,
      acp:acps(nom, email_facturation, email_rapport, email_factures, email_rapports, email_communications),
      syndic:organisations(nom, email, email_factures, email_rapports, email_communications)
    `)
    .eq('id', id)
    .maybeSingle();
  if (ivErr) return NextResponse.json({ ok: false, error: ivErr.message }, { status: 500 });
  if (!iv) return NextResponse.json({ ok: false, error: 'Intervention introuvable.' }, { status: 404 });

  type IvWithRels = Intervention & {
    acp: Acp | Acp[] | null;
    syndic: Organisation | Organisation[] | null;
  };
  const ivJoined = iv as unknown as IvWithRels;
  const intervention = ivJoined as Intervention;
  const acp = Array.isArray(ivJoined.acp) ? (ivJoined.acp[0] ?? null) : ivJoined.acp;
  const syndic = Array.isArray(ivJoined.syndic) ? (ivJoined.syndic[0] ?? null) : ivJoined.syndic;
  const pc = intervention.particulier_contact as ParticulierContact | null;

  // Cascade ACP → Syndic → legacy → particulier (type 'communication')
  const recipient = getEmailForDoc({ acp, syndic, particulier_contact: pc }, 'communication');
  const clientEmail = recipient.email;
  if (!clientEmail) {
    return NextResponse.json(
      { ok: false, error: 'Aucun email destinataire (cascade ACP/Syndic/particulier vide).' },
      { status: 400 },
    );
  }
  if (!intervention.creneau_debut) {
    return NextResponse.json({ ok: false, error: 'Aucun créneau défini.' }, { status: 400 });
  }

  // Charge le technicien si assigné
  let techNom = '';
  if (intervention.technicien_id) {
    const { data: tech } = await supabase
      .from('utilisateurs')
      .select('prenom, nom, email')
      .eq('id', intervention.technicien_id)
      .maybeSingle();
    if (tech) {
      const t = tech as Pick<Utilisateur, 'prenom' | 'nom' | 'email'>;
      techNom = [t.prenom, t.nom].filter(Boolean).join(' ') || (t.email ?? '');
    }
  }

  const creneauDate = new Date(intervention.creneau_debut);
  const dateFr = creneauDate.toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const heureFr = creneauDate.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });
  const adresseStr = intervention.adresse
    ?? (pc?.adresse ? [pc.adresse.rue, pc.adresse.code_postal, pc.adresse.ville].filter(Boolean).join(', ') : '');

  const html = buildHtml({
    prenom: pc?.prenom ?? '',
    ref: intervention.ref ?? '?',
    date: dateFr,
    heure: heureFr,
    adresse: adresseStr,
    technicienNom: techNom,
    type: intervention.type ?? '',
  });

  const send = await sendEmail({
    to: clientEmail,
    subject: `FoxO — Confirmation intervention ${intervention.ref ?? ''}`,
    html,
  });

  if (!send.ok) {
    if (send.error === 'Google non connecté.') {
      return NextResponse.json({ ok: false, error: send.error, code: 'google_not_connected' }, { status: 503 });
    }
    return NextResponse.json({ ok: false, error: send.error }, { status: 502 });
  }

  // Statut → confirmee + timeline
  await supabase
    .from('interventions')
    .update({ statut: 'confirmee', updated_at: new Date().toISOString() })
    .eq('id', id);

  try {
    const admin = createAdminClient();
    await admin.from('intervention_timeline').insert({
      intervention_id: id,
      type: 'confirmation_envoyee',
      message: 'Confirmation envoyée au client',
      payload: { to: clientEmail, gmail_message_id: send.id },
      created_by: user.email ?? 'admin',
    });
  } catch (e) {
    console.warn('[confirm-mail] timeline insert skipped:', e);
  }

  return NextResponse.json({ ok: true, message_id: send.id });
}
