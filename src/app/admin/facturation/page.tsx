import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import type { Facture } from '@/lib/types/database';
import { FacturationListClient } from './FacturationListClient';

export const dynamic = 'force-dynamic';

export default async function FacturationPage() {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('factures')
    .select('*')
    .eq('type', 'facture')
    .order('date_emission', { ascending: false, nullsFirst: false })
    .order('numero', { ascending: false })
    .limit(500);

  const factures = (data ?? []) as Facture[];

  // Pré-fetch des avoirs ACTIFS (statut ≠ annulee) pour calculer le
  // statut "couverture par avoir" de chaque facture en une seule passe.
  // Pas de jointure côté SQL — on le fait en mémoire sur le résultat.
  const factureIds = factures.map((f) => f.id);
  type AvoirAggLite = { facture_origine_id: string; montant_ttc: number; statut: string };
  let avoirsAgg: AvoirAggLite[] = [];
  if (factureIds.length > 0) {
    const { data: avoirsRaw } = await supabase
      .from('factures')
      .select('facture_origine_id, montant_ttc, statut')
      .eq('type', 'avoir')
      .in('facture_origine_id', factureIds)
      .neq('statut', 'annulee');
    avoirsAgg = ((avoirsRaw ?? []) as Array<{ facture_origine_id: string | null; montant_ttc: number | null; statut: string }>)
      .filter((a) => a.facture_origine_id !== null)
      .map((a) => ({ facture_origine_id: a.facture_origine_id as string, montant_ttc: Number(a.montant_ttc ?? 0), statut: a.statut }));
  }
  // Map id → { totalEmis, totalAll }
  type AvoirsState = { totalEmis: number; totalAll: number };
  const avoirsByFacture: Record<string, AvoirsState> = {};
  for (const a of avoirsAgg) {
    if (!avoirsByFacture[a.facture_origine_id]) avoirsByFacture[a.facture_origine_id] = { totalEmis: 0, totalAll: 0 };
    const abs = Math.abs(a.montant_ttc);
    avoirsByFacture[a.facture_origine_id].totalAll += abs;
    if (a.statut !== 'brouillon') avoirsByFacture[a.facture_origine_id].totalEmis += abs;
  }

  return (
    <>
      <header className="px-6 py-4 flex flex-wrap items-center justify-between gap-3 bg-sand border-b border-sand-border flex-shrink-0">
        <div>
          <h1 className="text-xl font-extrabold text-ink">Facturation</h1>
          <p className="text-[11px] text-ink-muted mt-0.5">
            {factures.length} facture(s) chargée(s)
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/admin/facturation/new"
            className="bg-navy text-white px-3.5 py-2 rounded-lg text-xs font-bold hover:opacity-90"
          >
            + Nouvelle facture
          </Link>
        </div>
      </header>

      {error && (
        <div className="mx-6 mt-3 px-4 py-2.5 bg-amber-light border border-[#E8C896] text-[#8A5A1A] rounded-lg text-xs font-semibold flex-shrink-0">
          Erreur de chargement : {error.message}
        </div>
      )}

      <div className="flex-1 overflow-auto px-6 py-5">
        <FacturationListClient initialFactures={factures} avoirsByFacture={avoirsByFacture} />
      </div>
    </>
  );
}
