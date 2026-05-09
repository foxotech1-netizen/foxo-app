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
      <div className="mb-6 pb-3.5 border-b border-[var(--color-sand-border)]">
        <h1 className="fxs-page-title mb-1">
          Catalogue <span>articles</span>
        </h1>
        <div className="flex items-center gap-2 text-[11px] text-[var(--color-ink-mid)] tracking-wide">
          <span className="w-1 h-1 rounded-full bg-[var(--color-navy)]"></span>
          {articles.length} prestation{articles.length > 1 ? 's' : ''} — saisie en TTC, HTVA recalculé automatiquement
        </div>
      </div>

      <div>
        <ArticlesClient initial={articles} />
      </div>
    </>
  );
}
