import type { ReactNode } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  FileText,
  Mail,
  Pause,
  Receipt,
  type LucideIcon,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { StatutBadge } from '@/components/StatutBadge';
import { fmtDate, relTime } from '@/lib/format';
import {
  STATUT_FACTURE_INFO,
  type Acp,
  type Facture,
  type Intervention,
  type NoteFrais,
} from '@/lib/types/database';

export const dynamic = 'force-dynamic';

// Auth gate géré par /admin/layout.tsx parent — on s'appuie dessus
// (même pattern que alertes/page.tsx et hub/page.tsx).

// Formatage montant — calque le fmtMoney local de FacturationListClient /
// NotesFraisClient (pas de helper partagé exporté côté @/lib/format).
function fmtMoney(n: number | null | undefined): string {
  const v = typeof n === 'number' ? n : 0;
  return v.toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

type MailAnalyseRow = Pick<
  // mails_analyses : clé primaire = thread_id ; colonnes sujet/expediteur/recu_le
  // ajoutées par la migration 2026-05-19_mails_analyses_add_email_metadata_columns.
  { thread_id: string; sujet: string | null; expediteur: string | null; recu_le: string | null; urgence: boolean | null },
  'thread_id' | 'sujet' | 'expediteur' | 'recu_le' | 'urgence'
>;

type RapportRow = Pick<Intervention, 'id' | 'ref' | 'statut' | 'adresse' | 'acp_id' | 'updated_at'>;
type FactureRow = Pick<Facture, 'id' | 'numero' | 'montant_ttc' | 'client_nom' | 'statut' | 'type'>;
type NoteFraisRow = Pick<NoteFrais, 'id' | 'technicien_nom' | 'technicien_email' | 'montant_ttc' | 'date_depense' | 'statut'>;
type AcpLite = Pick<Acp, 'id' | 'nom' | 'adresse'>;

export default async function ValidationPage() {
  const supabase = await createClient();

  const [analysesRes, rapportsRes, facturesRes, notesRes, ivsRes] = await Promise.all([
    // 1. Analyses mails à confirmer : demande d'intervention sans dossier lié.
    supabase
      .from('mails_analyses')
      .select('thread_id, sujet, expediteur, recu_le, urgence')
      .eq('type', 'demande_intervention')
      .is('dossier_match_id', null)
      .order('recu_le', { ascending: false }),
    // 2. Rapports à valider : interventions au statut 'rapport'.
    supabase
      .from('interventions')
      .select('id, ref, statut, adresse, acp_id, updated_at')
      .eq('statut', 'rapport')
      .is('deleted_at', null)
      .order('updated_at', { ascending: false }),
    // 3. Factures / devis en brouillon.
    supabase
      .from('factures')
      .select('id, numero, montant_ttc, client_nom, statut, type')
      .eq('statut', 'brouillon')
      .is('deleted_at', null)
      .order('created_at', { ascending: false }),
    // 4. Notes de frais à approuver : statut 'soumise'.
    supabase
      .from('notes_frais')
      .select('id, technicien_nom, technicien_email, montant_ttc, date_depense, statut')
      .eq('statut', 'soumise')
      .order('date_depense', { ascending: false }),
    // 5. Interventions en suspens : on charge le minimum pour appliquer le
    // prédicat en mémoire (cf. plus bas).
    supabase
      .from('interventions')
      .select('statut, technicien_id')
      .is('deleted_at', null),
  ]);

  const analyses = (analysesRes.data ?? []) as MailAnalyseRow[];
  const rapports = (rapportsRes.data ?? []) as RapportRow[];
  const factures = (facturesRes.data ?? []) as FactureRow[];
  const notes = (notesRes.data ?? []) as NoteFraisRow[];

  // TODO consolidation : prédicat dupliqué depuis layout.tsx alertCount, à factoriser à l'étape 2
  const ivs = (ivsRes.data ?? []) as Pick<Intervention, 'statut' | 'technicien_id'>[];
  const suspensCount = ivs.filter(
    (i) => i.statut === 'en_suspens' || (i.statut === 'nouvelle' && !i.technicien_id),
  ).length;

  // ACP (nom/adresse) pour les lignes "Rapports à valider".
  const acpIds = Array.from(new Set(rapports.map((r) => r.acp_id).filter(Boolean) as string[]));
  const acpRes = acpIds.length
    ? await supabase.from('acps').select('id, nom, adresse').in('id', acpIds)
    : { data: [] as AcpLite[] };
  const acpMap = new Map(((acpRes.data ?? []) as AcpLite[]).map((a) => [a.id, a]));

  const totalAValider =
    analyses.length + rapports.length + factures.length + notes.length + suspensCount;

  return (
    <>
      <div className="flex justify-between items-end mb-6 pb-3.5 border-b border-[var(--color-sand-border)]">
        <div>
          <h1 className="fxs-page-title mb-1">File de validation</h1>
          <div className="flex items-center gap-2 text-[11px] text-[var(--color-ink-mid)] tracking-wide">
            <span className="w-1 h-1 rounded-full bg-[var(--color-terra)]"></span>
            {totalAValider} élément{totalAValider > 1 ? 's' : ''} à valider
          </div>
        </div>
      </div>

      <div className="space-y-6">
        {/* 1. Analyses mails à confirmer */}
        <Section title="Analyses mails à confirmer" icon={Mail} count={analyses.length} empty={analyses.length === 0}>
          <Table head={['Sujet', 'Expéditeur', 'Reçu le', 'Urgence']}>
            {analyses.map((a) => (
              <tr key={a.thread_id} className="border-b border-sand-mid hover:bg-sand-hover">
                <td className="px-3.5 py-3">
                  <Link
                    href={`/admin/mails?id=${encodeURIComponent(a.thread_id)}`}
                    className="text-[13px] font-semibold text-navy hover:underline"
                  >
                    {a.sujet ?? '—'}
                  </Link>
                </td>
                <td className="px-3.5 py-3 text-[12px] text-ink-mid">{a.expediteur ?? '—'}</td>
                <td className="px-3.5 py-3 text-[11px] text-ink-muted font-mono whitespace-nowrap">{fmtDate(a.recu_le)}</td>
                <td className="px-3.5 py-3">
                  {a.urgence ? <AlertTriangle size={14} className="text-terra" aria-hidden /> : <span className="text-ink-muted">—</span>}
                </td>
              </tr>
            ))}
          </Table>
        </Section>

        {/* 2. Rapports à valider */}
        <Section title="Rapports à valider" icon={FileText} count={rapports.length} empty={rapports.length === 0}>
          <Table head={['Réf.', 'ACP / Adresse', 'Màj', 'Statut']}>
            {rapports.map((r) => {
              const acp = r.acp_id ? acpMap.get(r.acp_id) ?? null : null;
              return (
                <tr key={r.id} className="border-b border-sand-mid hover:bg-sand-hover">
                  <td className="px-3.5 py-3">
                    <Link href={`/admin?id=${r.id}`} className="font-mono text-xs font-semibold text-navy hover:underline">
                      {r.ref ?? '—'}
                    </Link>
                  </td>
                  <td className="px-3.5 py-3 text-[13px]">{acp?.nom ?? acp?.adresse ?? r.adresse ?? '—'}</td>
                  <td className="px-3.5 py-3 text-[10px] text-ink-muted font-mono">{relTime(r.updated_at)}</td>
                  <td className="px-3.5 py-3"><StatutBadge statut={r.statut} /></td>
                </tr>
              );
            })}
          </Table>
        </Section>

        {/* 3. Factures / devis en brouillon */}
        <Section title="Factures / devis en brouillon" icon={Banknote} count={factures.length} empty={factures.length === 0}>
          <Table head={['Numéro', 'Montant', 'Client', 'Statut']}>
            {factures.map((f) => {
              const info = STATUT_FACTURE_INFO[f.statut];
              return (
                <tr key={f.id} className="border-b border-sand-mid hover:bg-sand-hover">
                  <td className="px-3.5 py-3">
                    <Link href={`/admin/facturation/${f.id}`} className="font-mono text-xs font-semibold text-navy hover:underline">
                      {f.numero ?? '—'}
                    </Link>
                  </td>
                  <td className="px-3.5 py-3 text-[12px] font-semibold whitespace-nowrap">{fmtMoney(f.montant_ttc)}</td>
                  <td className="px-3.5 py-3 text-[12px]">{f.client_nom ?? '—'}</td>
                  <td className="px-3.5 py-3">
                    <span
                      className="inline-block rounded-full font-semibold whitespace-nowrap"
                      style={{ color: info.fg, background: info.bg, fontSize: 11, padding: '3px 9px' }}
                    >
                      {info.label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </Table>
        </Section>

        {/* 4. Notes de frais à approuver */}
        <Section title="Notes de frais à approuver" icon={Receipt} count={notes.length} empty={notes.length === 0}>
          <Table head={['Technicien', 'Montant', 'Date', 'Statut']}>
            {notes.map((n) => (
              <tr key={n.id} className="border-b border-sand-mid hover:bg-sand-hover">
                <td className="px-3.5 py-3">
                  <Link href="/admin/notes-frais" className="text-[13px] font-semibold text-navy hover:underline">
                    {n.technicien_nom ?? n.technicien_email}
                  </Link>
                </td>
                <td className="px-3.5 py-3 text-[12px] font-semibold whitespace-nowrap">{fmtMoney(n.montant_ttc)}</td>
                <td className="px-3.5 py-3 text-[11px] text-ink-muted font-mono whitespace-nowrap">{fmtDate(n.date_depense)}</td>
                <td className="px-3.5 py-3">
                  {/* Pas de label-map exporté pour StatutNoteFrais — on rend la
                      valeur de statut telle quelle (data-driven, sans recréer de labels). */}
                  <span className="inline-block rounded-full font-semibold bg-sand text-ink-mid" style={{ fontSize: 11, padding: '3px 9px' }}>
                    {n.statut}
                  </span>
                </td>
              </tr>
            ))}
          </Table>
        </Section>

        {/* 5. Interventions en suspens — pas de re-listing : compteur + lien Alertes. */}
        <Section title="Interventions en suspens" icon={Pause} count={suspensCount} empty={false}>
          <div className="bg-cream rounded-xl border border-sand-border p-4 flex items-center justify-between gap-3">
            <p className="text-[13px] text-ink-mid">
              {suspensCount > 0 ? (
                <>{suspensCount} dossier{suspensCount > 1 ? 's' : ''} à traiter dans Alertes.</>
              ) : (
                <>Rien à valider.</>
              )}
            </p>
            <Link
              href="/admin/alertes"
              className="inline-flex items-center gap-1.5 text-[12px] font-bold text-navy hover:underline whitespace-nowrap"
            >
              Voir dans Alertes
              <ArrowRight size={14} aria-hidden />
            </Link>
          </div>
        </Section>
      </div>
    </>
  );
}

function Section({
  title, icon: Icon, count, empty, children,
}: {
  title: string;
  icon: LucideIcon;
  count: number;
  empty: boolean;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg border bg-navy-pale border-navy-light dark:bg-[#1B3A6B] dark:border-[#2A5298] mb-3">
        <Icon size={18} className="text-navy dark:text-white" aria-hidden />
        <div className="flex-1">
          <h2 className="text-sm font-bold text-navy dark:text-[#F0ECE4]">{title}</h2>
        </div>
        <span className="text-sm font-extrabold text-navy dark:text-white">{count}</span>
      </div>

      {empty ? (
        <p className="text-xs text-ink-muted bg-cream border border-sand-border rounded-lg p-4 text-center">
          Rien à valider.
        </p>
      ) : (
        children
      )}
    </section>
  );
}

function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="bg-cream rounded-xl border border-sand-border overflow-hidden">
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-sand">
            {head.map((h) => (
              <th key={h} className="px-3.5 py-2.5 text-left text-[10px] font-bold text-ink-muted uppercase tracking-wider border-b border-sand-border whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
