import { createClient } from '@/lib/supabase/server';
import type { Parametre } from '@/lib/types/database';
import { ParametresClient } from './ParametresClient';

export const dynamic = 'force-dynamic';
// Le bouton "Vérifier maintenant" appelle triggerCheckMailsNow qui
// invoque runCheckMails — jusqu'à 5 mails × ~7s ≈ 35s. Le default
// (10s sur Hobby) tuait l'action avant la fin.
export const maxDuration = 60;

export default async function ParametresPage() {
  const supabase = await createClient();
  const { data } = await supabase.from('parametres').select('*');
  const params = (data ?? []) as Parametre[];
  const map: Record<string, string> = {};
  for (const p of params) map[p.cle] = p.valeur ?? '';

  return (
    <>
      <div className="mb-6 pb-3.5 border-b border-[var(--color-sand-border)]">
        <h1 className="fxs-page-title mb-1">
          Paramètres
        </h1>
        <div className="flex items-center gap-2 text-[11px] text-[var(--color-ink-mid)] tracking-wide">
          <span className="w-1 h-1 rounded-full bg-[var(--color-navy)]"></span>
          Configuration de la plateforme Fox Group SRL
        </div>
      </div>

      <div id="parametres-scroll">
        <ParametresClient initial={map} />
      </div>
    </>
  );
}
