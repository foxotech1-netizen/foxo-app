import { createClient } from '@/lib/supabase/server';
import type { FactureAchat } from '@/lib/types/database';
import { AchatsListClient, type FactureAchatRow } from './AchatsListClient';

export const dynamic = 'force-dynamic';
// La relève manuelle de la boîte de capture (Server Action de ce segment)
// enchaîne jusqu'à 5 extractions IA (~10-50 s pièce) : plafond maximal.
export const maxDuration = 300;

export default async function AchatsPage() {
  const supabase = await createClient();
  const [{ data, error }, aliasRes] = await Promise.all([
    supabase
      .from('factures_achat')
      .select('*, intervention:interventions(ref), fournisseur:fournisseurs(nom)')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(500),
    supabase.from('parametres').select('valeur').eq('cle', 'capture_alias_email').maybeSingle(),
  ]);
  const captureAlias = ((aliasRes.data?.valeur as string | undefined) ?? '').trim();

  const rows = ((data ?? []) as unknown as Array<
    FactureAchat & { intervention: { ref: string | null } | null; fournisseur: { nom: string | null } | null }
  >).map((r): FactureAchatRow => ({
    ...r,
    intervention_ref: r.intervention?.ref ?? null,
    fournisseur_fiche_nom: r.fournisseur?.nom ?? null,
  }));

  return (
    <>
      <div className="flex justify-between items-end mb-6 pb-3.5 border-b border-[var(--color-sand-border)]">
        <div>
          <h1 className="fxs-page-title mb-1">Factures d&apos;achat</h1>
          <div className="flex items-center gap-2 text-[11px] text-[var(--color-ink-mid)] tracking-wide">
            <span className="w-1 h-1 rounded-full bg-[var(--color-navy)]"></span>
            Capture, validation et paiement des factures fournisseurs
          </div>
        </div>
      </div>
      {error ? (
        <div className="text-[13px] text-terra bg-terra-light border border-terra-mid rounded-xl px-4 py-3">
          Erreur de chargement des factures d&apos;achat : {error.message}
        </div>
      ) : (
        <AchatsListClient initial={rows} captureAlias={captureAlias} />
      )}
    </>
  );
}
