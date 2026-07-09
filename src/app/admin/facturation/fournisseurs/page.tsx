import { createClient } from '@/lib/supabase/server';
import type { Fournisseur } from '@/lib/types/database';
import { FournisseursClient } from './FournisseursClient';

export const dynamic = 'force-dynamic';

export default async function FournisseursPage() {
  const supabase = await createClient();
  const [{ data, error }, verifRes] = await Promise.all([
    supabase
      .from('fournisseurs')
      .select('*')
      .is('deleted_at', null)
      .order('nom', { ascending: true }),
    // Dernière vérification anti-fraude de l'IBAN par fournisseur (max des
    // factures_achat.iban_verifie_at) — affichée dans le drawer.
    supabase
      .from('factures_achat')
      .select('fournisseur_id, iban_verifie_at')
      .not('iban_verifie_at', 'is', null)
      .is('deleted_at', null),
  ]);

  const derniereVerifIban: Record<string, string> = {};
  for (const r of (verifRes.data ?? []) as Array<{ fournisseur_id: string | null; iban_verifie_at: string | null }>) {
    if (!r.fournisseur_id || !r.iban_verifie_at) continue;
    const cur = derniereVerifIban[r.fournisseur_id];
    if (!cur || r.iban_verifie_at > cur) derniereVerifIban[r.fournisseur_id] = r.iban_verifie_at;
  }

  return (
    <>
      <div className="flex justify-between items-end mb-6 pb-3.5 border-b border-[var(--color-sand-border)]">
        <div>
          <h1 className="fxs-page-title mb-1">Fournisseurs</h1>
          <div className="flex items-center gap-2 text-[11px] text-[var(--color-ink-mid)] tracking-wide">
            <span className="w-1 h-1 rounded-full bg-[var(--color-navy)]"></span>
            Fiches fournisseurs du module achats
          </div>
        </div>
      </div>
      {error ? (
        <div className="text-[13px] text-terra bg-terra-light border border-terra-mid rounded-xl px-4 py-3">
          Erreur de chargement des fournisseurs : {error.message}
        </div>
      ) : (
        <FournisseursClient initial={(data ?? []) as Fournisseur[]} derniereVerifIban={derniereVerifIban} />
      )}
    </>
  );
}
