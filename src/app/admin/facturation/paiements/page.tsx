import { createClient } from '@/lib/supabase/server';
import type { Facture, StatutFacture } from '@/lib/types/database';
import { PaiementsClient } from './PaiementsClient';

export const dynamic = 'force-dynamic';

export default async function PaiementsPage() {
  const supabase = await createClient();

  // Récupère les factures pour les listes "Récents paiements" et "En attente"
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('factures')
    .select('id, numero, client_nom, client_syndic, reference, montant_ttc, date_emission, date_echeance, date_paiement, statut, sent_at')
    .order('date_emission', { ascending: false, nullsFirst: false })
    .limit(500);

  type Lite = Pick<Facture, 'id' | 'numero' | 'client_nom' | 'client_syndic' | 'reference' | 'montant_ttc' | 'date_emission' | 'date_echeance' | 'date_paiement' | 'statut' | 'sent_at'>;
  const all = ((data ?? []) as Lite[]).map((f): Lite => {
    if (f.statut === 'envoyee' && f.date_echeance && f.date_echeance < today) {
      return { ...f, statut: 'en_retard' as StatutFacture };
    }
    return f;
  });

  const recentes = all.filter((f) => f.statut === 'payee').slice(0, 30);
  const enAttente = all
    .filter((f) => f.statut === 'envoyee' || f.statut === 'en_retard')
    .sort((a, b) => (a.date_echeance ?? '').localeCompare(b.date_echeance ?? ''));

  return (
    <>
      <header className="px-6 py-4 flex flex-wrap items-center justify-between gap-3 bg-sand border-b border-sand-border flex-shrink-0">
        <div>
          <h1 className="text-xl font-extrabold text-ink">Paiements</h1>
          <p className="text-[11px] text-ink-muted mt-0.5">
            Import Beobank, paiements récents et factures en attente.
          </p>
        </div>
      </header>

      {error && (
        <div className="mx-6 mt-3 px-4 py-2.5 bg-amber-light border border-[#E8C896] text-[#8A5A1A] rounded-lg text-xs font-semibold flex-shrink-0">
          Erreur de chargement : {error.message}
        </div>
      )}

      <div className="flex-1 overflow-auto px-6 py-5">
        <PaiementsClient recentes={recentes} enAttente={enAttente} todayIso={today} />
      </div>
    </>
  );
}
