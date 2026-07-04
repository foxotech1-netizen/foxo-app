import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import type { Article } from '@/lib/types/database';
import { FactureEditor } from '../../FactureEditor';
import { genererNumeroProvisoire } from '@/lib/facturation/numerotation';

export const dynamic = 'force-dynamic';

export default async function NewDevisPage() {
  const supabase = await createClient();
  const articlesRes = await supabase
    .from('articles').select('*').eq('actif', true).order('code', { ascending: true });
  const articles = (articlesRes.data ?? []) as Article[];
  // Numéro provisoire de brouillon — le définitif est attribué à l'émission.
  const initialNumero = genererNumeroProvisoire();

  return (
    <>
      <div className="flex justify-between items-end mb-6 pb-3.5 border-b border-[var(--color-sand-border)]">
        <div>
          <h1 className="fxs-page-title mb-1">
            Nouveau devis
          </h1>
          <div className="flex items-center gap-2 text-[11px] text-[var(--color-ink-mid)] tracking-wide">
            <span className="w-1 h-1 rounded-full bg-[var(--color-navy)]"></span>
            Numéro définitif attribué à l&apos;émission
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
