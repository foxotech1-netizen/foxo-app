import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { Article, Facture } from '@/lib/types/database';
import { FactureEditor } from '../../FactureEditor';
import { SendByEmailButton } from '../../SendByEmailButton';
import { buildDocumentEmailDefaults } from '@/lib/facturation/email-defaults';

export const dynamic = 'force-dynamic';

export default async function EditDevisPage({
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
  const devis = factureRes.data as Facture;
  if (devis.type !== 'devis') notFound();
  const articles = (articlesRes.data ?? []) as Article[];

  let clientEmailFactures: string | null = null;
  if (devis.client_id) {
    const { data: c } = await supabase
      .from('clients')
      .select('email_factures')
      .eq('id', devis.client_id)
      .maybeSingle();
    clientEmailFactures = (c?.email_factures as string | null | undefined) ?? null;
  }
  const emailDefaults = buildDocumentEmailDefaults({ facture: devis, clientEmailFactures });

  return (
    <>
      <div className="flex flex-wrap justify-between items-end gap-3 mb-6 pb-3.5 border-b border-[var(--color-sand-border)]">
        <div>
          <h1 className="fxs-page-title mb-1">
            Devis <span className="font-mono">{devis.numero}</span>
          </h1>
          <div className="flex items-center gap-2 text-[11px] text-[var(--color-ink-mid)] tracking-wide">
            <span className="w-1 h-1 rounded-full bg-[var(--color-navy)]"></span>
            Statut : <strong className="capitalize">{devis.statut}</strong>
            {devis.converted_to_facture_id && (
              <> · <Link href={`/admin/facturation/${devis.converted_to_facture_id}`} className="text-[var(--color-navy)] underline">Facture liée →</Link></>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <SendByEmailButton facture={devis} defaults={emailDefaults} />
          <Link href="/admin/facturation/devis" className="text-[12px] text-[var(--color-ink-mid)] hover:text-[var(--color-navy)] min-h-[44px] inline-flex items-center">
            ← Retour
          </Link>
        </div>
      </div>
      <div>
        <FactureEditor initial={devis} initialNumero={devis.numero} articles={articles} mode="devis" />
      </div>
    </>
  );
}
