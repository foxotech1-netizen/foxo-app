import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import type { Article } from '@/lib/types/database';
import { FactureEditor } from '../FactureEditor';
import { generateNextNumero } from '../actions';

export const dynamic = 'force-dynamic';

export default async function NewFacturePage() {
  const supabase = await createClient();

  const [articlesRes, numeroRes] = await Promise.all([
    supabase.from('articles').select('*').eq('actif', true).order('code', { ascending: true }),
    generateNextNumero(),
  ]);

  const articles = (articlesRes.data ?? []) as Article[];
  const initialNumero = numeroRes.ok ? numeroRes.data!.numero : 'FV2026-100';

  return (
    <>
      <header className="px-6 py-4 flex items-center justify-between bg-sand border-b border-sand-border flex-shrink-0">
        <div>
          <h1 className="text-xl font-extrabold text-ink">Nouvelle facture</h1>
          <p className="text-[11px] text-ink-muted mt-0.5">
            N° proposé : <span className="font-mono">{initialNumero}</span> (modifiable)
          </p>
        </div>
        <Link
          href="/admin/facturation"
          className="text-[12px] text-ink-mid hover:text-navy dark:text-[#C8C2B8]"
        >
          ← Retour à la liste
        </Link>
      </header>

      <div className="flex-1 overflow-auto px-6 py-5">
        <FactureEditor initial={null} initialNumero={initialNumero} articles={articles} />
      </div>
    </>
  );
}
