import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmailResend } from '@/lib/email/resend';

// Déclencheur best-effort : prévient le(s) partenaire(s) d'une intervention
// qu'un message admin (FoxO) vient d'être posté. Crée une notification in-app
// par utilisateur de l'organisation + envoie un email aux utilisateurs ET
// délégués actifs.
//
// CONTRAT : ne lance JAMAIS d'exception et ne bloque jamais l'appelant — tout
// échec (intervention absente, table manquante, email KO) est seulement loggé.
// On utilise createAdminClient (service-role) car l'INSERT dans `notifications`
// est réservé aux admins par RLS (policy notifications_admin_insert).
export async function notifyPartnerOfMessage(input: {
  interventionId: string;
  auteurEmail: string | null;
}): Promise<void> {
  const { interventionId } = input;
  try {
    const admin = createAdminClient();

    // 1. Intervention + ses liens organisation.
    const { data: iv, error: ivErr } = await admin
      .from('interventions')
      .select('id, syndic_id, organisation_id')
      .eq('id', interventionId)
      .single();
    if (ivErr || !iv) {
      if (ivErr) console.error('[notify-partner-message] intervention introuvable:', ivErr.message);
      return;
    }

    // 2. Org cibles = syndic_id + organisation_id, sans null, dédoublonnées.
    const orgIds = Array.from(
      new Set(
        [iv.syndic_id, iv.organisation_id].filter(
          (x): x is string => typeof x === 'string' && x.length > 0,
        ),
      ),
    );
    if (orgIds.length === 0) return;

    // 3. Destinataires NOTIFICATION : utilisateurs actifs de ces organisations.
    const { data: users, error: usersErr } = await admin
      .from('utilisateurs')
      .select('id, email')
      .in('organisation_id', orgIds)
      .eq('actif', true);
    if (usersErr) console.error('[notify-partner-message] lecture utilisateurs KO:', usersErr.message);

    // 4. Destinataires EMAIL supplémentaires : délégués actifs de ces organisations.
    const { data: delegues, error: delErr } = await admin
      .from('delegues')
      .select('email')
      .in('organisation_id', orgIds)
      .eq('actif', true);
    if (delErr) console.error('[notify-partner-message] lecture délégués KO:', delErr.message);

    const userRows = (users ?? []) as { id: string; email: string | null }[];
    const delegueRows = (delegues ?? []) as { email: string | null }[];

    // 5. Insert des notifications in-app (un seul insert avec tableau).
    const notifRows = userRows
      .filter((u) => typeof u.id === 'string' && u.id.length > 0)
      .map((u) => ({
        destinataire_id: u.id,
        intervention_id: interventionId,
        type: 'message',
        titre: 'Nouveau message de FoxO',
        message:
          'Vous avez reçu un nouveau message concernant une intervention. Connectez-vous au portail pour le consulter.',
        lien: '/portal/interventions',
      }));
    if (notifRows.length > 0) {
      const { error: notifErr } = await admin.from('notifications').insert(notifRows);
      if (notifErr) console.error('[notify-partner-message] insert notifications KO:', notifErr.message);
    }

    // 6. Ensemble dédoublonné des emails (minuscules) : utilisateurs + délégués.
    const emails = Array.from(
      new Set(
        [...userRows, ...delegueRows]
          .map((r) => (r.email ?? '').trim().toLowerCase())
          .filter((e) => e.length > 0),
      ),
    );
    if (emails.length === 0) return;

    // 7. Envoi email best-effort en parallèle (Promise.allSettled).
    const subject = 'FoxO — nouveau message sur votre intervention';
    const html =
      '<p>Bonjour,</p>' +
      '<p>Vous avez reçu un nouveau message de FoxO concernant une de vos interventions.</p>' +
      '<p>Connectez-vous à votre portail pour le consulter : ' +
      '<a href="https://portal.foxo.be">portal.foxo.be</a></p>';

    const results = await Promise.allSettled(
      emails.map((to) => sendEmailResend({ to, subject, html })),
    );
    for (const r of results) {
      if (r.status === 'rejected') {
        console.error('[notify-partner-message] email throw:', r.reason);
      } else if (!r.value.ok) {
        console.error('[notify-partner-message] email KO:', r.value.error);
      }
    }
  } catch (e) {
    console.error(
      '[notify-partner-message] erreur inattendue:',
      e instanceof Error ? e.message : e,
    );
    return;
  }
}
