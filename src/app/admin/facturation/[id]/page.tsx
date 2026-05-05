import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { Article, Facture } from '@/lib/types/database';
import { FactureEditor } from '../FactureEditor';
import { FactureActions } from './FactureActions';
import { SendByEmailButton } from '../SendByEmailButton';
import { buildDocumentEmailDefaults } from '@/lib/facturation/email-defaults';

export const dynamic = 'force-dynamic';

export default async function EditFacturePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [factureRes, articlesRes] = await Promise.all([
    supabase.from('factures').select('*').eq('id', id).maybeSingle(),
    supabase.from('articles').select('*').eq('actif', true).order('code', { ascending: true }),
  ]);

  if (!factureRes.data) notFound();
  const facture = factureRes.data as Facture;

  // Redirige vers la bonne sous-page si l'utilisateur a accédé à
  // /admin/facturation/[id] avec l'id d'un devis ou d'un avoir.
  if (facture.type === 'devis') {
    redirect(`/admin/facturation/devis/${id}`);
  }
  if (facture.type === 'avoir') {
    redirect(`/admin/facturation/notes-credit/${id}`);
  }

  // Avoirs ACTIFS liés à la facture (statut ≠ annulee) — pour le bandeau
  // solde réel.
  const { data: avoirsRaw } = await supabase
    .from('factures')
    .select('id, numero, montant_ttc, statut')
    .eq('type', 'avoir')
    .eq('facture_origine_id', facture.id)
    .neq('statut', 'annulee')
    .is('deleted_at', null)
    .order('numero', { ascending: true });
  const avoirs = ((avoirsRaw ?? []) as Array<{ id: string; numero: string; montant_ttc: number | null; statut: string }>);
  const totalCredite = avoirs.reduce((s, a) => s + Math.abs(Number(a.montant_ttc ?? 0)), 0);
  const totalCrediteEmis = avoirs
    .filter((a) => a.statut !== 'brouillon')
    .reduce((s, a) => s + Math.abs(Number(a.montant_ttc ?? 0)), 0);
  const factureTtc = Number(facture.montant_ttc ?? 0);
  const soldeReel = Math.max(0, factureTtc - totalCrediteEmis);
  const articles = (articlesRes.data ?? []) as Article[];

  // Pré-calcule défauts pour la modale d'envoi email. Cascade destinataire :
  // clients.email_factures (override dédié) → facture.client_email.
  let clientEmailFactures: string | null = null;
  if (facture.client_id) {
    const { data: c } = await supabase
      .from('clients')
      .select('email_factures')
      .eq('id', facture.client_id)
      .maybeSingle();
    clientEmailFactures = (c?.email_factures as string | null | undefined) ?? null;
  }
  const emailDefaults = buildDocumentEmailDefaults({ facture, clientEmailFactures });

  return (
    <>
      <header className="px-6 py-4 flex flex-wrap items-center justify-between gap-3 bg-sand border-b border-sand-border flex-shrink-0">
        <div>
          <h1 className="text-xl font-extrabold text-ink">
            Facture <span className="font-mono">{facture.numero}</span>
          </h1>
          <p className="text-[11px] text-ink-muted mt-0.5">
            Statut : <strong className="capitalize">{facture.statut}</strong>
            {facture.date_paiement && ` · Payée le ${new Date(facture.date_paiement).toLocaleDateString('fr-BE')}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <SendByEmailButton facture={facture} defaults={emailDefaults} />
          <FactureActions facture={facture} />
          <Link
            href="/admin/facturation"
            className="text-[12px] text-ink-mid hover:text-navy min-h-[44px] inline-flex items-center"
          >
            ← Retour
          </Link>
        </div>
      </header>

      <div className="flex-1 overflow-auto px-6 py-5">
        {avoirs.length > 0 && (
          <div className="mb-4 bg-amber-light border border-[#E8C896] rounded-2xl px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-bold text-[#8A5A1A] uppercase tracking-wider mb-1">
                  📝 {avoirs.length} avoir(s) lié(s) — solde réel
                </div>
                <div className="flex flex-wrap items-baseline gap-3 text-[13px]">
                  <span className="text-ink-mid">
                    Facture : <strong className="font-mono">{factureTtc.toFixed(2)} €</strong>
                  </span>
                  <span className="text-terra">
                    − Avoirs émis : <strong className="font-mono">{totalCrediteEmis.toFixed(2)} €</strong>
                  </span>
                  <span className="text-navy font-bold">
                    = Solde réel : <span className="font-mono">{soldeReel.toFixed(2)} €</span>
                  </span>
                </div>
                {totalCredite > totalCrediteEmis && (
                  <div className="text-[11px] text-ink-muted mt-1 italic">
                    + {(totalCredite - totalCrediteEmis).toFixed(2)} € en brouillon (non encore émis).
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {avoirs.map((a) => (
                  <Link
                    key={a.id}
                    href={`/admin/facturation/notes-credit/${a.id}`}
                    className="text-[10px] font-mono font-bold bg-white text-terra border border-terra-mid rounded px-2 py-1 hover:bg-terra-light"
                    title={`${a.statut} · ${Math.abs(Number(a.montant_ttc ?? 0)).toFixed(2)} €`}
                  >
                    {a.numero}
                  </Link>
                ))}
              </div>
            </div>
          </div>
        )}
        <FactureEditor initial={facture} initialNumero={facture.numero} articles={articles} />
      </div>
    </>
  );
}
