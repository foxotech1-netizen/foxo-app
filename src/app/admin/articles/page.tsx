import { createClient } from '@/lib/supabase/server';
import type { Article } from '@/lib/types/database';
import { ArticlesClient } from './ArticlesClient';

export const dynamic = 'force-dynamic';

export default async function ArticlesPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from('articles')
    .select('*')
    .order('code', { ascending: true });
  const articles = (data ?? []) as Article[];

  return (
    <>
      <header className="px-6 py-4 bg-sand border-b border-sand-border flex-shrink-0">
        <h1 className="text-xl font-extrabold text-ink">Catalogue d&apos;articles</h1>
        <p className="text-[11px] text-ink-muted mt-0.5">
          {articles.length} prestation(s) — saisie en TTC, HTVA recalculé automatiquement
        </p>
      </header>

      <div className="flex-1 overflow-auto px-6 py-5">
        <ArticlesClient initial={articles} />
      </div>
    </>
  );
}
