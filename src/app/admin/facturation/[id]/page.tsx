import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { Article, Facture } from '@/lib/types/database';
import { FactureEditor } from '../FactureEditor';

export const dynamic = 'force-dynamic';

export default async function EditFacturePage({
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
  const facture = factureRes.data as Facture;
  const articles = (articlesRes.data ?? []) as Article[];

  return (
    <>
      <header className="px-6 py-4 flex flex-wrap items-center justify-between gap-3 bg-sand border-b border-sand-border flex-shrink-0">
        <div>
          <h1 className="text-xl font-extrabold text-ink">
            Facture <span className="font-mono">{facture.numero}</span>
          </h1>
          <p className="text-[11px] text-ink-muted mt-0.5">
            Statut : <strong className="capitalize">{facture.statut}</strong>
            {facture.date_paiement && ` · Payée le ${new Date(facture.date_paiement).toLocaleDateString('fr-BE')}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <a
            href={`/api/admin/facture/${facture.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="bg-navy text-white px-3 py-2 rounded-lg text-[12px] font-bold hover:opacity-90"
          >
            📄 Voir le PDF
          </a>
          <Link
            href="/admin/facturation"
            className="text-[12px] text-ink-mid hover:text-navy dark:text-[#C8C2B8]"
          >
            ← Retour
          </Link>
        </div>
      </header>

      <div className="flex-1 overflow-auto px-6 py-5">
        <FactureEditor initial={facture} initialNumero={facture.numero} articles={articles} />
      </div>
    </>
  );
}
