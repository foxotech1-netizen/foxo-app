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
    .is('deleted_at', null)
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
      .neq('statut', 'annulee')
      .is('deleted_at', null);
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
      <div className="flex flex-wrap items-end justify-between gap-3 mb-6 pb-3.5 border-b border-[var(--color-sand-border)]">
        <div>
          <h1 className="fxs-page-title mb-1">
            Factura<span>tion</span>
          </h1>
          <div className="flex items-center gap-2 text-[11px] text-[var(--color-ink-mid)] tracking-wide">
            <span className="w-1 h-1 rounded-full bg-[var(--color-navy)]"></span>
            {factures.length} facture{factures.length > 1 ? 's' : ''} chargée{factures.length > 1 ? 's' : ''}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/admin/facturation/new"
            className="bg-[var(--color-navy)] hover:bg-[var(--color-navy-dark)] text-[var(--color-cream)] px-3.5 py-2 rounded-md text-xs font-medium shadow-sm"
          >
            + Nouvelle facture
          </Link>
        </div>
      </div>

      {error && (
        <div className="mb-3 px-4 py-2.5 bg-[var(--color-amber-light)] border border-[var(--color-amber-foxo)]/30 text-[var(--color-amber-foxo)] rounded-lg text-xs font-semibold">
          Erreur de chargement : {error.message}
        </div>
      )}

      <div>
        <FacturationListClient initialFactures={factures} avoirsByFacture={avoirsByFacture} />
      </div>
    </>
  );
}
