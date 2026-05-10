// POST /api/admin/sms/send
// Body : { phone: string, body: string, thread_id?: string }
// Response : { success, sid?, status?, error? }
//
// Envoie le SMS via Twilio (sendSMS de @/lib/sms qui lit
// TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_PHONE_NUMBER).
// Si thread_id fourni : log dans intervention_timeline du dossier
// rattaché (best-effort).

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { roleForEmail } from '@/lib/auth/roles';
import { sendSMS } from '@/lib/sms';

export const dynamic = 'force-dynamic';

interface SmsSendBody {
  phone?: unknown;
  body?: unknown;
  thread_id?: unknown;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || roleForEmail(user.email) !== 'admin') {
    return NextResponse.json({ success: false, error: 'Accès refusé.' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as SmsSendBody;
  const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
  const text = typeof body.body === 'string' ? body.body.trim() : '';
  const threadId = typeof body.thread_id === 'string' ? body.thread_id.trim() : null;

  if (!phone || !text) {
    return NextResponse.json({ success: false, error: 'phone + body requis.' }, { status: 400 });
  }
  if (text.length > 320) {
    return NextResponse.json({ success: false, error: 'Body trop long (>320 chars).' }, { status: 400 });
  }

  const r = await sendSMS(phone, text);
  if (!r.ok) {
    return NextResponse.json({ success: false, error: r.error }, { status: 502 });
  }

  // Log timeline best-effort si thread_id rattaché à un dossier
  if (threadId) {
    const admin = createAdminClient();
    try {
      const { data: ana } = await admin
        .from('mails_analyses')
        .select('dossier_match_id')
        .eq('thread_id', threadId)
        .maybeSingle();
      const dossierId = (ana as { dossier_match_id: string | null } | null)?.dossier_match_id;
      if (dossierId) {
        await admin.from('intervention_timeline').insert({
          intervention_id: dossierId,
          type: 'sms_envoye',
          message: `SMS envoyé à ${phone} — ${text.slice(0, 50)}${text.length > 50 ? '…' : ''}`,
          payload: { phone, body: text, sid: r.sid, channel: r.channel },
          created_by: user.email ?? 'admin',
        });
      }
    } catch (e) {
      // Timeline absente / RLS — ne bloque pas le succès du SMS
      console.warn('[sms/send] timeline insert skipped:', e);
    }
  }

  return NextResponse.json({ success: true, sid: r.sid, channel: r.channel });
}
