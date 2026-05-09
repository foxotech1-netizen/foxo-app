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
      <div className="mb-6 pb-3.5 border-b border-[var(--color-sand-border)]">
        <h1 className="fxs-page-title mb-1">
          <span>Paiements</span>
        </h1>
        <div className="flex items-center gap-2 text-[11px] text-[var(--color-ink-mid)] tracking-wide">
          <span className="w-1 h-1 rounded-full bg-[var(--color-navy)]"></span>
          Import Beobank, paiements récents et factures en attente
        </div>
      </div>

      {error && (
        <div className="mb-3 px-4 py-2.5 bg-[var(--color-amber-light)] border border-[var(--color-amber-foxo)]/30 text-[var(--color-amber-foxo)] rounded-lg text-xs font-semibold">
          Erreur de chargement : {error.message}
        </div>
      )}

      <div>
        <PaiementsClient recentes={recentes} enAttente={enAttente} todayIso={today} />
      </div>
    </>
  );
}
