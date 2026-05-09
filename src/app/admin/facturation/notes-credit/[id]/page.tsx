import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { Article, Facture } from '@/lib/types/database';
import { FactureEditor } from '../../FactureEditor';
import { SendByEmailButton } from '../../SendByEmailButton';
import { buildDocumentEmailDefaults } from '@/lib/facturation/email-defaults';

export const dynamic = 'force-dynamic';

export default async function EditAvoirPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const [factureRes, articlesRes] = await Promise.all([
    supabase.from('factures').select('*').eq('id', id).maybeSingle(),
    supabase.from('articles').select('*').eq('actif', true).order('code', { ascending: true }),
  ]);
  if (!factureRes.data) notFound();
  const avoir = factureRes.data as Facture;
  if (avoir.type !== 'avoir') notFound();
  const articles = (articlesRes.data ?? []) as Article[];

  // Charge le numéro de la facture d'origine pour affichage
  let origineNumero: string | null = null;
  if (avoir.facture_origine_id) {
    const { data: o } = await supabase
      .from('factures')
      .select('numero')
      .eq('id', avoir.facture_origine_id)
      .maybeSingle();
    origineNumero = (o?.numero as string) ?? null;
  }

  let clientEmailFactures: string | null = null;
  if (avoir.client_id) {
    const { data: c } = await supabase
      .from('clients')
      .select('email_factures')
      .eq('id', avoir.client_id)
      .maybeSingle();
    clientEmailFactures = (c?.email_factures as string | null | undefined) ?? null;
  }
  const emailDefaults = buildDocumentEmailDefaults({
    facture: avoir,
    clientEmailFactures,
    factureOrigineNumero: origineNumero,
  });

  return (
    <>
      <div className="flex flex-wrap justify-between items-end gap-3 mb-6 pb-3.5 border-b border-[var(--color-sand-border)]">
        <div>
          <h1 className="fxs-page-title mb-1">
            Note de crédit <span className="font-mono">{avoir.numero}</span>
          </h1>
          <div className="flex items-center gap-2 text-[11px] text-[var(--color-ink-mid)] tracking-wide">
            <span className="w-1 h-1 rounded-full bg-[var(--color-navy)]"></span>
            Statut : <strong className="capitalize">{avoir.statut}</strong>
            {avoir.facture_origine_id && (
              <> · Lié à <Link href={`/admin/facturation/${avoir.facture_origine_id}`} className="font-mono text-[var(--color-navy)] underline">
                {origineNumero ?? '?'}
              </Link></>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <SendByEmailButton facture={avoir} defaults={emailDefaults} />
          <Link href="/admin/facturation/notes-credit" className="text-[12px] text-[var(--color-ink-mid)] hover:text-[var(--color-navy)] min-h-[44px] inline-flex items-center">
            ← Retour
          </Link>
        </div>
      </div>
      <div>
        <FactureEditor initial={avoir} initialNumero={avoir.numero} articles={articles} mode="avoir" />
      </div>
    </>
  );
}
