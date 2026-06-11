import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isAdminUser } from "@/lib/auth/server";
import { EXCLUDE_PLATFORM_MAILS_Q, ONLY_PLATFORM_MAILS_Q, listInboxMails } from '@/lib/gmail';
import { CLASSIFICATION_TO_LABEL } from '@/lib/mail/categories';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Force toute couche de cache (browser, CDN Vercel, fetch RSC) à ne
// rien stocker. Sans ça, "↻ Actualiser" peut servir un payload obsolète.
const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  Pragma: 'no-cache',
};

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await isAdminUser())) {
    return NextResponse.json(
      { ok: false, error: 'Accès refusé.' },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  const url = new URL(request.url);
  // Default 50 (au lieu de 30) — on peut toujours réduire via ?limit=
  const limitRaw = parseInt(url.searchParams.get('limit') ?? '50', 10) || 50;
  const limit = Math.min(Math.max(1, limitRaw), 100);    // borne dure
  const filter = url.searchParams.get('filter');
  const label = url.searchParams.get('label');
  // Construit la query Gmail. trash et inbox sont exclusifs.
  // Onglets métier (Mails V2 P1) : a_traiter / demandes / occupants /
  // archives s'ajoutent aux modes historiques tous / system / trash.
  const parts: string[] = [];
  if (filter === 'trash') {
    parts.push('in:trash');
  } else if (filter === 'system') {
    // Vue « Système » : uniquement les mails transactionnels émis par FoxO.
    parts.push('in:inbox', ONLY_PLATFORM_MAILS_Q);
  } else if (filter === 'a_traiter') {
    // « À traiter » métier = non lus de l'inbox, hors mails plateforme.
    // Même définition que countUnreadMails → le badge de l'onglet et la
    // liste restent cohérents sans compteur supplémentaire.
    parts.push('in:inbox', 'is:unread', EXCLUDE_PLATFORM_MAILS_Q);
  } else if (filter === 'demandes') {
    parts.push(`label:"${CLASSIFICATION_TO_LABEL.nouvelle_demande}"`, EXCLUDE_PLATFORM_MAILS_Q);
  } else if (filter === 'occupants') {
    parts.push(`label:"${CLASSIFICATION_TO_LABEL.reponse_occupant}"`, EXCLUDE_PLATFORM_MAILS_Q);
  } else if (filter === 'archives') {
    // Gmail n'a pas d'opérateur « archivé » : un mail archivé est un mail
    // qui n'a plus le label INBOX. On approxime donc par exclusion — ni
    // inbox, ni corbeille, ni spam, ni brouillons, ni envoyés (sans
    // -in:sent la vue serait noyée par le courrier sortant, lui aussi
    // hors inbox). Vérifié sur l'API : les opérateurs négatifs -in: sont
    // supportés dans messages.list?q= comme dans la barre Gmail.
    parts.push('-in:inbox', '-in:trash', '-in:spam', '-in:draft', '-in:sent', EXCLUDE_PLATFORM_MAILS_Q);
  } else {
    parts.push('in:inbox');
    // Par défaut (« Tous »), les mails envoyés par la plateforme elle-même
    // sont masqués (visibles via filter=system) : la liste reflète les
    // mails réellement à traiter.
    parts.push(EXCLUDE_PLATFORM_MAILS_Q);
  }
  if (label) parts.push(`label:"${label.replace(/"/g, '')}"`);
  const q = parts.join(' ');

  const res = await listInboxMails({ limit, q });
  if (!res.ok) {
    return NextResponse.json(
      { ok: false, error: res.error },
      { status: 502, headers: NO_STORE_HEADERS },
    );
  }
  return NextResponse.json(
    { ok: true, mails: res.mails },
    { headers: NO_STORE_HEADERS },
  );
}
