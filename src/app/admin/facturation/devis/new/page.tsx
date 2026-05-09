import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import type { Article } from '@/lib/types/database';
import { FactureEditor } from '../../FactureEditor';
import { generateNextNumero } from '../../actions';

export const dynamic = 'force-dynamic';

export default async function NewDevisPage() {
  const supabase = await createClient();
  const [articlesRes, numeroRes] = await Promise.all([
    supabase.from('articles').select('*').eq('actif', true).order('code', { ascending: true }),
    generateNextNumero('devis'),
  ]);
  const articles = (articlesRes.data ?? []) as Article[];
  const initialNumero = numeroRes.ok ? numeroRes.data!.numero : 'DEV2026-001';

  return (
    <>
      <div className="flex justify-between items-end mb-6 pb-3.5 border-b border-[var(--color-sand-border)]">
        <div>
          <h1 className="fxs-page-title mb-1">
            Nouveau devis
          </h1>
          <div className="flex items-center gap-2 text-[11px] text-[var(--color-ink-mid)] tracking-wide">
            <span className="w-1 h-1 rounded-full bg-[var(--color-navy)]"></span>
            N° proposé : <span className="font-mono">{initialNumero}</span> (modifiable)
          </div>
        </div>
        <Link href="/admin/facturation/devis" className="text-[12px] text-[var(--color-ink-mid)] hover:text-[var(--color-navy)]">
          ← Retour à la liste
        </Link>
      </div>
      <div>
        <FactureEditor initial={null} initialNumero={initialNumero} articles={articles} mode="devis" />
      </div>
    </>
  );
}
