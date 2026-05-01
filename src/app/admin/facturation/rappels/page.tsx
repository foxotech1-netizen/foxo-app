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
      <header className="px-6 py-4 flex flex-wrap items-center justify-between gap-3 bg-sand border-b border-sand-border flex-shrink-0">
        <div>
          <h1 className="text-xl font-extrabold text-ink">Rappels de paiement</h1>
          <p className="text-[11px] text-ink-muted mt-0.5">
            Configure les rappels automatiques et envoie des rappels manuels.
          </p>
        </div>
      </header>

      <div className="flex-1 overflow-auto px-6 py-5">
        <RappelsClient
          initialParams={initialParams}
          enRetard={enRetard}
          todayIso={today}
        />
      </div>
    </>
  );
}
