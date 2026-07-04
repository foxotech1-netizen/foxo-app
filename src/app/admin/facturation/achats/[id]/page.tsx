import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { FactureAchat, Fournisseur, RegleMapping } from '@/lib/types/database';
import { AchatDetailClient } from './AchatDetailClient';

export const dynamic = 'force-dynamic';

export default async function AchatDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [achatRes, fournisseursRes, reglesRes] = await Promise.all([
    supabase.from('factures_achat').select('*').eq('id', id).is('deleted_at', null).maybeSingle(),
    supabase.from('fournisseurs').select('*').is('deleted_at', null).eq('actif', true).order('nom', { ascending: true }),
    supabase.from('regles_mapping').select('*').eq('actif', true).order('priorite', { ascending: true }),
  ]);
  if (!achatRes.data) notFound();
  const achat = achatRes.data as FactureAchat;
  const fournisseurs = (fournisseursRes.data ?? []) as Fournisseur[];

  // Suggestions de catégories comptables (issues des règles de mapping).
  const categoriesSuggestions = [...new Set(
    ((reglesRes.data ?? []) as RegleMapping[])
      .map((r) => r.categorie_comptable)
      .filter((c): c is string => Boolean(c && c.trim())),
  )];

  // Contexte lié : original du doublon + réf du dossier lié.
  let doublonOriginal: { id: string; numero_piece: string | null; fournisseur_nom: string | null } | null = null;
  if (achat.doublon_de_id) {
    const { data: d } = await supabase
      .from('factures_achat')
      .select('id, numero_piece, fournisseur_nom')
      .eq('id', achat.doublon_de_id)
      .maybeSingle();
    doublonOriginal = (d as typeof doublonOriginal) ?? null;
  }
  let interventionRef: string | null = null;
  if (achat.intervention_id) {
    const { data: iv } = await supabase
      .from('interventions')
      .select('ref')
      .eq('id', achat.intervention_id)
      .maybeSingle();
    interventionRef = (iv?.ref as string | null) ?? null;
  }

  return (
    <>
      <div className="flex flex-wrap justify-between items-end gap-3 mb-6 pb-3.5 border-b border-[var(--color-sand-border)]">
        <div>
          <h1 className="fxs-page-title mb-1">
            Facture d&apos;achat{' '}
            <span className="font-mono">{achat.numero_piece ?? '(sans n°)'}</span>
          </h1>
          <div className="flex items-center gap-2 text-[11px] text-[var(--color-ink-mid)] tracking-wide">
            <span className="w-1 h-1 rounded-full bg-[var(--color-navy)]"></span>
            {achat.fournisseur_nom ?? 'Fournisseur inconnu'} · source {achat.source}
          </div>
        </div>
        <Link
          href="/admin/facturation/achats"
          className="text-[12px] text-[var(--color-ink-mid)] hover:text-[var(--color-navy)] min-h-[44px] inline-flex items-center"
        >
          ← Retour à la liste
        </Link>
      </div>
      <AchatDetailClient
        achat={achat}
        fournisseurs={fournisseurs}
        categoriesSuggestions={categoriesSuggestions}
        doublonOriginal={doublonOriginal}
        interventionRef={interventionRef}
      />
    </>
  );
}
