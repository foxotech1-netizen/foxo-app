import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { TYPE_CLIENT_LABEL, type Client, type Facture } from '@/lib/types/database';
import { ClientForm } from '../ClientForm';

export const dynamic = 'force-dynamic';

function fmtMoney(n: number | null | undefined): string {
  const v = typeof n === 'number' ? n : 0;
  return v.toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  // L'id recu peut etre un id de CLIENT ou un id d'ACP : le bouton « Fiche »
  // d'une ACP (drawer syndic + recap destinataires) passe l'id de l'ACP.
  // Resolution : d'abord par id de client, puis en repli par acp_id — chaque
  // ACP a un client miroir type='acp' lie via clients.acp_id (migration
  // 2026-05-30_sync_acps_clients).
  const byId = await supabase.from('clients').select('*').eq('id', id).maybeSingle();
  const byAcp = byId.data
    ? null
    : await supabase.from('clients').select('*').eq('acp_id', id).limit(1).maybeSingle();
  const clientRow = byId.data ?? byAcp?.data ?? null;
  if (!clientRow) notFound();
  const client = clientRow as Client;

  const { data: facturesData } = await supabase.from('factures')
    .select('id, numero, date_emission, montant_ttc, statut')
    .eq('client_id', client.id)
    .order('date_emission', { ascending: false })
    .limit(50);
  const factures = (facturesData ?? []) as Pick<Facture, 'id' | 'numero' | 'date_emission' | 'montant_ttc' | 'statut'>[];

  return (
    <>
      <div className="flex flex-wrap justify-between items-end gap-3 mb-6 pb-3.5 border-b border-[var(--color-sand-border)]">
        <div>
          <h1 className="fxs-page-title mb-1">
            {[client.prenom, client.nom].filter(Boolean).join(' ')}
          </h1>
          <div className="flex items-center gap-2 text-[11px] text-[var(--color-ink-mid)] tracking-wide">
            <span className="w-1 h-1 rounded-full bg-[var(--color-navy)]"></span>
            {TYPE_CLIENT_LABEL[client.type]} · {factures.length} facture{factures.length > 1 ? 's' : ''} liée{factures.length > 1 ? 's' : ''}
          </div>
        </div>
        <Link
          href="/admin/clients"
          className="text-[12px] text-[var(--color-ink-mid)] hover:text-[var(--color-navy)]"
        >
          ← Retour
        </Link>
      </div>

      <div className="space-y-6">
        <ClientForm initial={client} redirectAfter={`/admin/clients/${client.id}`} />

        <section className="max-w-[760px]">
          <h2 className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-mid mb-3 dark:text-[#C8C2B8]">
            Historique des factures
          </h2>
          {factures.length === 0 ? (
            <div className="bg-cream border border-sand-border rounded-2xl p-6 text-center text-[13px] text-ink-muted dark:bg-[#1C1A16] dark:border-[#2C2A24] dark:text-[#C8C2B8]">
              Aucune facture pour ce client.
            </div>
          ) : (
            <div className="bg-cream rounded-2xl border border-sand-border overflow-hidden dark:bg-[#1C1A16] dark:border-[#2C2A24]">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-sand dark:bg-[#221E1A]">
                    {['N°', 'Émission', 'Montant TTC', 'Statut'].map((h) => (
                      <th key={h} className="px-3.5 py-2.5 text-left text-[10px] font-bold text-ink-muted uppercase tracking-wider border-b border-sand-border dark:text-[#C8C2B8] dark:border-[#3D3A32]">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {factures.map((f) => (
                    <tr key={f.id} className="border-b border-sand-mid hover:bg-sand-hover dark:border-[#3D3A32] dark:hover:bg-[#2A2520]">
                      <td className="px-3.5 py-2.5">
                        <Link
                          href={`/admin/facturation/${f.id}`}
                          className="font-mono text-xs font-bold text-navy hover:underline dark:text-[#A8C4F2]"
                        >
                          {f.numero}
                        </Link>
                      </td>
                      <td className="px-3.5 py-2.5 text-[11px] text-ink-mid font-mono dark:text-[#C8C2B8]">
                        {fmtDate(f.date_emission)}
                      </td>
                      <td className="px-3.5 py-2.5 text-[12px] font-mono font-bold dark:text-white">
                        {fmtMoney(f.montant_ttc)}
                      </td>
                      <td className="px-3.5 py-2.5 text-[11px] capitalize dark:text-[#F0ECE4]">
                        {f.statut}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
