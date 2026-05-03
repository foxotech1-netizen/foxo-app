import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { Article, Facture } from '@/lib/types/database';
import { FactureEditor } from '../../FactureEditor';

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

  return (
    <>
      <header className="px-6 py-4 flex flex-wrap items-center justify-between gap-3 bg-sand border-b border-sand-border flex-shrink-0">
        <div>
          <h1 className="text-xl font-extrabold text-ink">
            Note de crédit <span className="font-mono">{avoir.numero}</span>
          </h1>
          <p className="text-[11px] text-ink-muted mt-0.5">
            Statut : <strong className="capitalize">{avoir.statut}</strong>
            {avoir.facture_origine_id && (
              <> · Lié à <Link href={`/admin/facturation/${avoir.facture_origine_id}`} className="font-mono text-navy underline">
                {origineNumero ?? '?'}
              </Link></>
            )}
          </p>
        </div>
        <Link href="/admin/facturation/notes-credit" className="text-[12px] text-ink-mid hover:text-navy dark:text-[#C8C2B8] min-h-[44px] inline-flex items-center">
          ← Retour
        </Link>
      </header>
      <div className="flex-1 overflow-auto px-6 py-5">
        <FactureEditor initial={avoir} initialNumero={avoir.numero} articles={articles} mode="avoir" />
      </div>
    </>
  );
}
