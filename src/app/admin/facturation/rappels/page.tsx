import { createClient } from '@/lib/supabase/server';
import type { Facture, StatutFacture } from '@/lib/types/database';
import { RappelsClient } from './RappelsClient';

export const dynamic = 'force-dynamic';

const PARAM_KEYS = [
  'rappels_auto_actifs',
  'rappel_delai_j1',
  'rappel_delai_j2',
  'rappel_template_email',
] as const;

const DEFAULT_TEMPLATE =
  'Bonjour,\n\nNous vous rappelons que la facture {ref} d\'un montant de {montant} € est en attente de règlement depuis {jours} jours.\n\nMerci de procéder au paiement dans les meilleurs délais.\n\nCordialement,\nFoxO';

export default async function RappelsPage() {
  const supabase = await createClient();

  const today = new Date().toISOString().slice(0, 10);

  const [paramsRes, facturesRes] = await Promise.all([
    supabase.from('parametres').select('cle, valeur').in('cle', PARAM_KEYS as unknown as string[]),
    supabase
      .from('factures')
      .select('id, numero, client_nom, client_syndic, reference, montant_ttc, date_echeance, statut, rappel_envoye_at, rappel_count')
      .order('date_echeance', { ascending: true, nullsFirst: false })
      .limit(500),
  ]);

  const paramsMap: Record<string, string> = {};
  for (const p of (paramsRes.data ?? []) as { cle: string; valeur: string | null }[]) {
    paramsMap[p.cle] = p.valeur ?? '';
  }
  const initialParams = {
    rappels_auto_actifs: paramsMap.rappels_auto_actifs === 'true',
    rappel_delai_j1: paramsMap.rappel_delai_j1 || '7',
    rappel_delai_j2: paramsMap.rappel_delai_j2 || '14',
    rappel_template_email: paramsMap.rappel_template_email || DEFAULT_TEMPLATE,
  };

  type Lite = Pick<Facture, 'id' | 'numero' | 'client_nom' | 'client_syndic' | 'reference' | 'montant_ttc' | 'date_echeance' | 'statut'> & {
    rappel_envoye_at: string | null;
    rappel_count: number | null;
  };
  const enRetard = ((facturesRes.data ?? []) as Lite[])
    .map((f): Lite => {
      if (f.statut === 'envoyee' && f.date_echeance && f.date_echeance < today) {
        return { ...f, statut: 'en_retard' as StatutFacture };
      }
      return f;
    })
    .filter((f) => f.statut === 'en_retard');

  return (
    <>
      <div className="mb-6 pb-3.5 border-b border-[var(--color-sand-border)]">
        <h1 className="fxs-page-title mb-1">
          Rappels de paiement
        </h1>
        <div className="flex items-center gap-2 text-[11px] text-[var(--color-ink-mid)] tracking-wide">
          <span className="w-1 h-1 rounded-full bg-[var(--color-terra)]"></span>
          Configure les rappels automatiques et envoie des rappels manuels
        </div>
      </div>

      <div>
        <RappelsClient
          initialParams={initialParams}
          enRetard={enRetard}
          todayIso={today}
        />
      </div>
    </>
  );
}
