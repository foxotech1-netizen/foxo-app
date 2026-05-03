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
      <header className="px-6 py-4 flex flex-wrap items-center justify-between gap-3 bg-sand border-b border-sand-border flex-shrink-0">
        <div>
          <h1 className="text-xl font-extrabold text-ink">
            Devis <span className="font-mono">{devis.numero}</span>
          </h1>
          <p className="text-[11px] text-ink-muted mt-0.5">
            Statut : <strong className="capitalize">{devis.statut}</strong>
            {devis.converted_to_facture_id && (
              <> · <Link href={`/admin/facturation/${devis.converted_to_facture_id}`} className="text-navy underline">Facture liée →</Link></>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <SendByEmailButton facture={devis} defaults={emailDefaults} />
          <Link href="/admin/facturation/devis" className="text-[12px] text-ink-mid hover:text-navy dark:text-[#C8C2B8] min-h-[44px] inline-flex items-center">
            ← Retour
          </Link>
        </div>
      </header>
      <div className="flex-1 overflow-auto px-6 py-5">
        <FactureEditor initial={devis} initialNumero={devis.numero} articles={articles} mode="devis" />
      </div>
    </>
  );
}
