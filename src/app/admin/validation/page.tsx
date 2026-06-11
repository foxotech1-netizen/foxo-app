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
import { CollapsedSection } from '@/components/admin/CollapsedSection';
import { fmtDate, relTime } from '@/lib/format';
import {
  STATUT_FACTURE_INFO,
  type Acp,
  type Facture,
  type NoteFrais,
} from '@/lib/types/database';
import {
  applyMailsAConfirmer,
  applyFacturesBrouillon,
  applyNotesFraisSoumises,
  getSuspensCount,
} from '@/lib/admin/validation-queue';

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
  { thread_id: string; sujet: string | null; expediteur: string | null; recu_le: string | null; urgence: boolean | null; created_at: string | null },
  'thread_id' | 'sujet' | 'expediteur' | 'recu_le' | 'urgence' | 'created_at'
>;

type FactureRow = Pick<Facture, 'id' | 'numero' | 'montant_ttc' | 'client_nom' | 'statut' | 'type' | 'organisation_id' | 'client_id'>;
type NoteFraisRow = Pick<NoteFrais, 'id' | 'technicien_nom' | 'technicien_email' | 'montant_ttc' | 'date_depense' | 'statut'>;
type AcpLite = Pick<Acp, 'id' | 'nom' | 'adresse'>;

export default async function ValidationPage() {
  const supabase = await createClient();

  // Prédicats centralisés dans @/lib/admin/validation-queue (source unique).
  const [analysesRes, facturesRes, notesRes, suspensCount] = await Promise.all([
    // 1. Analyses mails à confirmer : demande d'intervention sans dossier lié.
    applyMailsAConfirmer(
      supabase.from('mails_analyses').select('thread_id, sujet, expediteur, recu_le, urgence, created_at'),
    ).order('recu_le', { ascending: false }),
    // 3. Factures / devis en brouillon.
    applyFacturesBrouillon(
      supabase.from('factures').select('id, numero, montant_ttc, client_nom, statut, type, organisation_id, client_id'),
    ).order('created_at', { ascending: false }),
    // 4. Notes de frais à approuver : statut 'soumise'.
    applyNotesFraisSoumises(
      supabase.from('notes_frais').select('id, technicien_nom, technicien_email, montant_ttc, date_depense, statut'),
    ).order('date_depense', { ascending: false }),
    // 5. Interventions en suspens : compteur via le module partagé.
    getSuspensCount(supabase),
  ]);

  const analyses = (analysesRes.data ?? []) as MailAnalyseRow[];
  const factures = (facturesRes.data ?? []) as FactureRow[];

  // Fallback client_nom : factures historiques sans nom dénormalisé. Le client
  // est polymorphe → organisation_id (ACP/syndic) OU client_id (particulier).
  // Pattern 2-requêtes identique au bloc ACP ci-dessous (client session admin).
  const facturesSansNom = factures.filter((f) => !f.client_nom);
  const factOrgIds = Array.from(new Set(
    facturesSansNom.filter((f) => f.organisation_id).map((f) => f.organisation_id!),
  ));
  const factClientIds = Array.from(new Set(
    facturesSansNom.filter((f) => f.client_id && !f.organisation_id).map((f) => f.client_id!),
  ));
  const factOrgsRes = factOrgIds.length
    ? await supabase.from('organisations').select('id, nom').in('id', factOrgIds)
    : { data: [] as { id: string; nom: string }[] };
  const factClientsRes = factClientIds.length
    ? await supabase.from('clients').select('id, prenom, nom').in('id', factClientIds)
    : { data: [] as { id: string; prenom: string | null; nom: string }[] };
  const factOrgMap = new Map(
    ((factOrgsRes.data ?? []) as { id: string; nom: string }[]).map((o) => [o.id, o.nom]),
  );
  const factClientMap = new Map(
    ((factClientsRes.data ?? []) as { id: string; prenom: string | null; nom: string }[])
      .map((c) => [c.id, `${c.prenom ?? ''} ${c.nom ?? ''}`.trim()]),
  );
  const facturesEnrichies: FactureRow[] = factures.map((f) =>
    f.client_nom
      ? f
      : {
          ...f,
          client_nom:
            (f.organisation_id ? factOrgMap.get(f.organisation_id) ?? null : null)
            ?? (f.client_id ? factClientMap.get(f.client_id) ?? null : null),
        },
  );
  const notes = (notesRes.data ?? []) as NoteFraisRow[];

  // 2. Rapports à valider : basé sur rapports.statut (brouillon|valide),
  //    transmis exclu. Approche 2-requêtes (pas de FK fiable
  //    rapports→interventions pour un embed PostgREST).
  // 1) Rapports nécessitant une action admin
  const { data: rapportsRows } = await supabase
    .from('rapports')
    .select('intervention_id, statut, valide_at, transmis_at, updated_at')
    .in('statut', ['brouillon', 'valide'])
    .order('updated_at', { ascending: false });

  const rapportInterventionIds = (rapportsRows ?? []).map((r) => r.intervention_id);

  // 2) Détails interventions (exclut les soft-deleted)
  const { data: rapportInterventions } = rapportInterventionIds.length
    ? await supabase
        .from('interventions')
        .select('id, ref, adresse, acp_id')
        .in('id', rapportInterventionIds)
        .is('deleted_at', null)
    : { data: [] as { id: string; ref: string | null; adresse: string | null; acp_id: string | null }[] };

  const rapportInterventionById = new Map(
    (rapportInterventions ?? []).map((i) => [i.id, i]),
  );

  // 3) Fusion : on ne garde que les rapports dont l'intervention existe encore
  const rapportsAValider = (rapportsRows ?? [])
    .filter((r) => rapportInterventionById.has(r.intervention_id))
    .map((r) => {
      const interv = rapportInterventionById.get(r.intervention_id)!;
      return {
        id: interv.id,
        ref: interv.ref,
        adresse: interv.adresse,
        acp_id: interv.acp_id,
        rapportStatut: r.statut as 'brouillon' | 'valide',
        updatedAt: r.updated_at as string,
      };
    });

  // ACP (nom/adresse) pour les lignes "Rapports à valider".
  const acpIds = Array.from(new Set(rapportsAValider.map((r) => r.acp_id).filter(Boolean) as string[]));
  const acpRes = acpIds.length
    ? await supabase.from('acps').select('id, nom, adresse').in('id', acpIds)
    : { data: [] as AcpLite[] };
  const acpMap = new Map(((acpRes.data ?? []) as AcpLite[]).map((a) => [a.id, a]));

  const totalAValider =
    analyses.length + rapportsAValider.length + facturesEnrichies.length + notes.length + suspensCount;

  // Sections dans l'ordre métier d'origine ; à l'affichage, celles qui ont
  // des éléments passent devant, les vides sont repliées en lignes compactes.
  const sections = [
    {
      key: 'mails',
      title: 'Analyses mails à confirmer',
      icon: Mail,
      count: analyses.length,
      body: (
        <Table head={['Sujet', 'Expéditeur', 'Reçu le', 'Urgence']}>
            {analyses.map((a) => (
              <tr key={a.thread_id} className="border-b border-sand-mid hover:bg-sand-hover">
                <td className="px-3.5 py-3">
                  <Link
                    href={`/admin/mails?id=${encodeURIComponent(a.thread_id)}`}
                    className="text-[13px] font-semibold text-navy hover:underline"
                  >
                    {a.sujet ?? '(mail sans sujet)'}
                  </Link>
                </td>
                <td className="px-3.5 py-3 text-[12px] text-ink-mid">{a.expediteur ?? '—'}</td>
                <td className="px-3.5 py-3 text-[11px] text-ink-muted font-mono whitespace-nowrap">{a.recu_le ? fmtDate(a.recu_le) : a.created_at ? fmtDate(a.created_at) : '—'}</td>
                <td className="px-3.5 py-3">
                  {a.urgence ? <AlertTriangle size={14} className="text-terra" aria-hidden /> : <span className="text-ink-muted">—</span>}
                </td>
              </tr>
            ))}
          </Table>
      ),
    },
    {
      key: 'rapports',
      title: 'Rapports à valider',
      icon: FileText,
      count: rapportsAValider.length,
      body: (
        <Table head={['Réf.', 'ACP / Adresse', 'Màj', 'Statut']}>
            {rapportsAValider.map((r) => {
              const acp = r.acp_id ? acpMap.get(r.acp_id) ?? null : null;
              return (
                <tr key={r.id} className="border-b border-sand-mid hover:bg-sand-hover">
                  <td className="px-3.5 py-3">
                    <Link href={`/admin?id=${r.id}`} className="font-mono text-xs font-semibold text-navy hover:underline">
                      {r.ref ?? '—'}
                    </Link>
                  </td>
                  <td className="px-3.5 py-3 text-[13px]">{acp?.nom ?? acp?.adresse ?? r.adresse ?? '—'}</td>
                  <td className="px-3.5 py-3 text-[10px] text-ink-muted font-mono">{relTime(r.updatedAt)}</td>
                  <td className="px-3.5 py-3">
                    {r.rapportStatut === 'valide' ? (
                      <span
                        className="inline-block rounded-full text-[11px] font-semibold px-2.5 py-0.5"
                        style={{ color: 'var(--color-navy)', background: 'var(--color-navy-pale)' }}
                      >
                        Validé
                      </span>
                    ) : (
                      <span
                        className="inline-block rounded-full text-[11px] font-semibold px-2.5 py-0.5"
                        style={{ color: 'var(--color-ink-mid)', background: 'var(--color-sand-mid)' }}
                      >
                        Brouillon
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </Table>
      ),
    },
    {
      key: 'factures',
      title: 'Factures / devis en brouillon',
      icon: Banknote,
      count: facturesEnrichies.length,
      body: (
        <Table head={['Numéro', 'Montant', 'Client', 'Statut']}>
            {facturesEnrichies.map((f) => {
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
      ),
    },
    {
      key: 'notes-frais',
      title: 'Notes de frais à approuver',
      icon: Receipt,
      count: notes.length,
      body: (
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
      ),
    },
    {
      // Pas de re-listing : compteur + lien Alertes.
      key: 'suspens',
      title: 'Interventions en suspens',
      icon: Pause,
      count: suspensCount,
      body: (
        <div className="bg-cream rounded-xl border border-sand-border p-4 flex items-center justify-between gap-3">
          <p className="text-[13px] text-ink-mid">
            {suspensCount} dossier{suspensCount > 1 ? 's' : ''} à traiter dans Alertes.
          </p>
          <Link
            href="/admin/alertes"
            className="inline-flex items-center gap-1.5 text-[12px] font-bold text-navy hover:underline whitespace-nowrap"
          >
            Voir dans Alertes
            <ArrowRight size={14} aria-hidden />
          </Link>
        </div>
      ),
    },
  ];
  const actives = sections.filter((s) => s.count > 0);
  const vides = sections.filter((s) => s.count === 0);

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
        {actives.map((s) => (
          <Section key={s.key} title={s.title} icon={s.icon} count={s.count}>
            {s.body}
          </Section>
        ))}
        {vides.length > 0 && (
          <div className="space-y-2">
            {vides.map((s) => (
              <CollapsedSection key={s.key} icon={s.icon} title={s.title} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// Rendue uniquement quand count > 0 — l'état vide est porté par
// CollapsedSection dans la page.
function Section({
  title, icon: Icon, count, children,
}: {
  title: string;
  icon: LucideIcon;
  count: number;
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

      {children}
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
