import { createClient } from '@/lib/supabase/server';
import type { Parametre } from '@/lib/types/database';
import { ParametresClient } from './ParametresClient';

export const dynamic = 'force-dynamic';

export default async function ParametresPage() {
  const supabase = await createClient();
  const { data } = await supabase.from('parametres').select('*');
  const params = (data ?? []) as Parametre[];
  const map: Record<string, string> = {};
  for (const p of params) map[p.cle] = p.valeur ?? '';

  return (
    <>
      <header className="px-6 py-4 bg-sand border-b border-sand-border flex-shrink-0">
        <h1 className="text-xl font-extrabold text-ink">Paramètres</h1>
        <p className="text-[11px] text-ink-muted mt-0.5">
          Configuration de la plateforme Fox Group SRL
        </p>
      </header>

      <div className="flex-1 overflow-auto px-6 py-5">
        <ParametresClient initial={map} />
      </div>
    </>
  );
}
