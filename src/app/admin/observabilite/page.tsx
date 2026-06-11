import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { fmtDateTime } from '@/lib/format';
import {
  getObservabilityStats,
  type ObservabilityPeriod,
} from '@/lib/observability/queries';
import type { AgentLog, AutomationJob } from '@/lib/types/database';

export const dynamic = 'force-dynamic';

// URL filtres :
//   ?period=<7d|30d|90d|all>                       (défaut 7d, scope global de la page)
//   ?agent=<triage_mail|analyse_pj|rapport|...>    (filtre table brute Agents IA)
//   ?agent_status=<success|error|partial|all>      (filtre statut table brute Agents IA)
//   ?automation=<check_mails|rappel_j1|...>        (filtre table Automatisations)
//   ?auto_status=<success|failed|skipped|all>      (filtre statut table Automatisations)
// NB DB : agent_logs.status utilise 'error' (pas 'failed'), automation_jobs
// utilise 'failed'. Le lien "Échecs" sous chaque tableau pointe sur la valeur DB.

const fmtCostEur = (cents: number) =>
  new Intl.NumberFormat('fr-BE', { style: 'currency', currency: 'EUR' }).format(cents / 100);

function fmtTokens(n: number | null): string {
  if (n == null) return '—';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

function statusClass(s: string): string {
  if (s === 'success') return 'bg-green-100 text-green-800';
  if (s === 'failed' || s === 'error') return 'bg-red-100 text-red-800';
  if (s === 'skipped') return 'bg-gray-100 text-gray-700';
  if (s === 'partial') return 'bg-amber-100 text-amber-800';
  return 'bg-gray-100 text-gray-700';
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold ${statusClass(status)}`}>
      {status}
    </span>
  );
}

function KindBadge({ kind }: { kind: 'canonical' | 'utility' }) {
  const cls =
    kind === 'canonical'
      ? 'bg-navy-pale text-navy'
      : 'bg-sand-mid text-ink-muted';
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${cls}`}>
      {kind}
    </span>
  );
}

function FilterLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  const base = 'px-2.5 py-1 rounded-md text-xs transition-colors';
  const cls = active
    ? `${base} bg-navy-pale text-navy font-semibold`
    : `${base} text-ink-muted hover:text-ink hover:bg-sand-mid`;
  return <Link href={href} className={cls}>{children}</Link>;
}

function param(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

function parsePeriod(v: string | undefined): ObservabilityPeriod {
  if (v === '30d' || v === '90d' || v === 'all') return v;
  return '7d';
}

function periodLabel(p: ObservabilityPeriod): string {
  switch (p) {
    case '7d': return '7 derniers jours';
    case '30d': return '30 derniers jours';
    case '90d': return '90 derniers jours';
    case 'all': return 'depuis le début';
  }
}

function periodCutoffIso(p: ObservabilityPeriod): string | null {
  switch (p) {
    case '7d': return new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
    case '30d': return new Date(Date.now() - 30 * 24 * 3600_000).toISOString();
    case '90d': return new Date(Date.now() - 90 * 24 * 3600_000).toISOString();
    case 'all': return null;
  }
}

type SearchParamsRaw = {
  period?: string | string[];
  agent?: string | string[];
  agent_status?: string | string[];
  automation?: string | string[];
  auto_status?: string | string[];
};

export default async function ObservabilitePage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsRaw>;
}) {
  const sp = await searchParams;
  const period = parsePeriod(param(sp.period));
  const agentFilter = param(sp.agent);
  const agentStatus = param(sp.agent_status);
  const automationFilter = param(sp.automation);
  const autoStatus = param(sp.auto_status);

  const supabase = await createClient();
  const cutoffIso = periodCutoffIso(period);

  // Tableau agents (brut) — filtres URL appliqués si présents + scope période.
  let agentLogsQuery = supabase
    .from('agent_logs')
    .select('id, agent_name, intervention_id, email_id, input_summary, output_summary, model_used, tokens_input, tokens_output, cost_eur_cents, duration_ms, status, error_message, confidence_score, created_at')
    .order('created_at', { ascending: false })
    .limit(50);
  if (cutoffIso) agentLogsQuery = agentLogsQuery.gte('created_at', cutoffIso);
  if (agentFilter && agentFilter !== 'all') {
    agentLogsQuery = agentLogsQuery.eq('agent_name', agentFilter);
  }
  if (agentStatus && agentStatus !== 'all') {
    agentLogsQuery = agentLogsQuery.eq('status', agentStatus);
  }

  // Tableau automations — filtres URL appliqués si présents + scope période.
  let autoJobsQuery = supabase
    .from('automation_jobs')
    .select('id, automation_name, intervention_id, action, result, status, error_message, executed_at')
    .order('executed_at', { ascending: false })
    .limit(50);
  if (cutoffIso) autoJobsQuery = autoJobsQuery.gte('executed_at', cutoffIso);
  if (automationFilter && automationFilter !== 'all') {
    autoJobsQuery = autoJobsQuery.eq('automation_name', automationFilter);
  }
  if (autoStatus && autoStatus !== 'all') {
    autoJobsQuery = autoJobsQuery.eq('status', autoStatus);
  }

  // 1 lecture agrégée (queries.ts) + 1 KPI autos + 2 tableaux filtrés.
  const confBase = supabase
    .from('agent_logs')
    .select('confidence_score')
    .not('confidence_score', 'is', null);
  const confQuery = cutoffIso ? confBase.gte('created_at', cutoffIso) : confBase;

  // Erreurs du cron mails (lot E) — la phase per-mail journalise l'échec dans
  // sms_logs (sent_by='cron:check-mails', status='failed'), seul endroit qui
  // garde le TEXTE de l'erreur (automation_jobs ne stocke que les compteurs).
  // Couvre runs manuels ET automatiques (Vercel cron).
  const cronErrBase = supabase
    .from('sms_logs')
    .select('id, created_at, message, error, twilio_sid')
    .eq('sent_by', 'cron:check-mails')
    .eq('status', 'failed')
    .order('created_at', { ascending: false })
    .limit(20);
  const cronErrQuery = cutoffIso ? cronErrBase.gte('created_at', cutoffIso) : cronErrBase;

  const [statsAgents, kpiAutosRes, agentLogsRes, autoJobsRes, confRes, cronErrRes] = await Promise.all([
    getObservabilityStats(period),
    cutoffIso
      ? supabase.from('automation_jobs').select('status').gte('executed_at', cutoffIso)
      : supabase.from('automation_jobs').select('status'),
    agentLogsQuery,
    autoJobsQuery,
    confQuery,
    cronErrQuery,
  ]);

  const kpiAutos = (kpiAutosRes.data ?? []) as { status: string }[];
  const confScores = (confRes.data ?? []) as { confidence_score: number | null }[];
  const cronErrors = (cronErrRes.data ?? []) as {
    id: string; created_at: string; message: string | null; error: string | null; twilio_sid: string | null;
  }[];
  const lowConfCount = confScores.filter(
    (r) => r.confidence_score != null && r.confidence_score < 0.7,
  ).length;

  const agentTotal = statsAgents.total_calls;
  const agentErrors = statsAgents.total_errors;
  const agentErrorRate = agentTotal === 0 ? 0 : Math.round((agentErrors / agentTotal) * 100);
  const agentCostCents = statsAgents.total_cost_eur_cents;

  const autoTotal = kpiAutos.length;
  const autoFailed = kpiAutos.filter((r) => r.status === 'failed').length;
  const autoFailedRate = autoTotal === 0 ? 0 : Math.round((autoFailed / autoTotal) * 100);

  const agentLogs = (agentLogsRes.data ?? []) as AgentLog[];
  const autoJobs = (autoJobsRes.data ?? []) as AutomationJob[];

  // Construit une URL préservant TOUS les params, à l'exception de ceux overridés.
  function buildHref(
    overrides: Partial<{ period: ObservabilityPeriod; agent: string; agent_status: string; automation: string; auto_status: string }>,
  ): string {
    const params = new URLSearchParams();
    const merged = {
      period: 'period' in overrides ? overrides.period : period,
      agent: 'agent' in overrides ? overrides.agent : agentFilter,
      agent_status: 'agent_status' in overrides ? overrides.agent_status : agentStatus,
      automation: 'automation' in overrides ? overrides.automation : automationFilter,
      auto_status: 'auto_status' in overrides ? overrides.auto_status : autoStatus,
    };
    if (merged.period && merged.period !== '7d') params.set('period', merged.period);
    if (merged.agent && merged.agent !== 'all') params.set('agent', merged.agent);
    if (merged.agent_status && merged.agent_status !== 'all') params.set('agent_status', merged.agent_status);
    if (merged.automation && merged.automation !== 'all') params.set('automation', merged.automation);
    if (merged.auto_status && merged.auto_status !== 'all') params.set('auto_status', merged.auto_status);
    const qs = params.toString();
    return qs ? `/admin/observabilite?${qs}` : '/admin/observabilite';
  }

  const agentStatusActive = agentStatus ?? 'all';
  const autoStatusActive = autoStatus ?? 'all';

  return (
    <>
      <div className="flex justify-between items-end mb-6 pb-3.5 border-b border-[var(--color-sand-border)]">
        <div>
          <h1 className="fxs-page-title mb-1">Observabilité IA</h1>
          <div className="flex items-center gap-2 text-[11px] text-[var(--color-ink-mid)] tracking-wide">
            <span className="w-1 h-1 rounded-full bg-[var(--color-navy)]"></span>
            {periodLabel(period)} • {agentTotal} appels agents • {autoTotal} jobs autos
          </div>
        </div>
        <div className="flex gap-1">
          <FilterLink href={buildHref({ period: '7d' })} active={period === '7d'}>7j</FilterLink>
          <FilterLink href={buildHref({ period: '30d' })} active={period === '30d'}>30j</FilterLink>
          <FilterLink href={buildHref({ period: '90d' })} active={period === '90d'}>90j</FilterLink>
          <FilterLink href={buildHref({ period: 'all' })} active={period === 'all'}>tout</FilterLink>
        </div>
      </div>

      <div className="space-y-6">
        {/* Bandeau KPI */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <KpiCard label="Appels agents" value={String(agentTotal)} />
          <KpiCard label="Taux erreur agents" value={`${agentErrorRate}%`} accent={agentErrorRate > 10 ? 'red' : 'neutral'} />
          <KpiCard label="Coût agents" value={fmtCostEur(agentCostCents)} />
          <KpiCard label="Confiance < 0.7" value={String(lowConfCount)} accent={lowConfCount > 0 ? 'red' : 'neutral'} />
          <KpiCard label="Taux failed autos" value={`${autoFailedRate}%`} accent={autoFailedRate > 10 ? 'red' : 'neutral'} />
        </div>

        {/* Section : Stats par agent (NOUVEAU) */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="fxs-section-title text-ink">Par agent</h2>
            <span className="text-[10px] text-ink-muted italic">
              Tous les agents connus apparaissent, même à 0 sur la période.
            </span>
          </div>

          <div className="bg-cream rounded-xl border border-sand-border overflow-hidden">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-sand">
                  {['Agent', 'Type', 'Appels', 'Erreurs', 'Taux erreur', 'Coût', 'Durée moy.'].map((h) => (
                    <th key={h} className="px-3.5 py-2.5 text-left text-[10px] font-bold text-ink-muted uppercase tracking-wider border-b border-sand-border whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {statsAgents.by_agent.map((row) => {
                  const taux = row.nb_calls === 0
                    ? null
                    : Math.round((row.nb_errors / row.nb_calls) * 100);
                  return (
                    <tr key={row.agent_name} className="border-b border-sand-mid hover:bg-sand-hover">
                      <td className="px-3.5 py-3 text-[12px] font-mono">
                        <Link
                          href={buildHref({ agent: row.agent_name, agent_status: 'all' })}
                          className="hover:underline text-navy"
                        >
                          {row.agent_name}
                        </Link>
                      </td>
                      <td className="px-3.5 py-3"><KindBadge kind={row.agent_kind} /></td>
                      <td className="px-3.5 py-3 text-[12px] font-mono text-ink whitespace-nowrap">{row.nb_calls}</td>
                      <td className="px-3.5 py-3 text-[12px] font-mono whitespace-nowrap">
                        <span className={row.nb_errors > 0 ? 'text-[var(--color-terra)] font-semibold' : 'text-ink-mid'}>
                          {row.nb_errors}
                        </span>
                      </td>
                      <td className="px-3.5 py-3 text-[11px] font-mono text-ink-mid whitespace-nowrap">
                        {taux == null ? '—' : `${taux}%`}
                      </td>
                      <td className="px-3.5 py-3 text-[11px] font-mono text-ink-mid whitespace-nowrap">
                        {fmtCostEur(row.total_cost_eur_cents)}
                      </td>
                      <td className="px-3.5 py-3 text-[11px] font-mono text-ink-mid whitespace-nowrap">
                        {row.avg_duration_ms == null ? '—' : `${row.avg_duration_ms}ms`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* Section Agents IA (table brute) */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="fxs-section-title text-ink">Agents IA (détails)</h2>
            <div className="flex gap-1">
              <FilterLink href={buildHref({ agent_status: 'all' })} active={agentStatusActive === 'all'}>Tous</FilterLink>
              <FilterLink href={buildHref({ agent_status: 'success' })} active={agentStatusActive === 'success'}>Réussis</FilterLink>
              <FilterLink href={buildHref({ agent_status: 'error' })} active={agentStatusActive === 'error'}>Échecs</FilterLink>
            </div>
          </div>

          {agentLogs.length === 0 ? (
            <p className="text-xs text-ink-muted bg-cream border border-sand-border rounded-lg p-4 text-center">
              Aucun appel agent sur ce filtre.
            </p>
          ) : (
            <div className="bg-cream rounded-xl border border-sand-border overflow-hidden">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-sand">
                    {['Quand', 'Agent', 'Modèle', 'Statut', 'Tokens in/out', 'Coût', 'Durée', 'Confiance', 'Intervention', 'Erreur'].map((h) => (
                      <th key={h} className="px-3.5 py-2.5 text-left text-[10px] font-bold text-ink-muted uppercase tracking-wider border-b border-sand-border whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {agentLogs.map((log) => (
                    <tr key={log.id} className="border-b border-sand-mid hover:bg-sand-hover">
                      <td className="px-3.5 py-3 text-[11px] text-ink-mid font-mono whitespace-nowrap">{fmtDateTime(log.created_at)}</td>
                      <td className="px-3.5 py-3 text-[12px] font-mono">{log.agent_name}</td>
                      <td className="px-3.5 py-3 text-[11px] text-ink-mid font-mono">{log.model_used ?? '—'}</td>
                      <td className="px-3.5 py-3"><StatusBadge status={log.status} /></td>
                      <td className="px-3.5 py-3 text-[11px] font-mono text-ink-mid whitespace-nowrap">
                        {fmtTokens(log.tokens_input)} / {fmtTokens(log.tokens_output)}
                      </td>
                      <td className="px-3.5 py-3 text-[11px] text-ink-mid font-mono whitespace-nowrap">
                        {log.cost_eur_cents != null ? fmtCostEur(log.cost_eur_cents) : '—'}
                      </td>
                      <td className="px-3.5 py-3 text-[11px] text-ink-mid font-mono whitespace-nowrap">
                        {log.duration_ms != null ? `${log.duration_ms}ms` : '—'}
                      </td>
                      <td className="px-3.5 py-3 text-[11px] font-mono whitespace-nowrap">
                        {log.confidence_score != null ? (
                          <span className={log.confidence_score < 0.7 ? 'text-[var(--color-terra)] font-semibold' : 'text-ink-mid'}>
                            {log.confidence_score.toFixed(2)}
                          </span>
                        ) : (
                          <span className="text-ink-mid">—</span>
                        )}
                      </td>
                      <td className="px-3.5 py-3 text-[11px]">
                        {log.intervention_id ? (
                          <Link href={`/admin/interventions/${log.intervention_id}`} className="font-mono text-navy hover:underline">
                            {log.intervention_id.slice(0, 8)}
                          </Link>
                        ) : '—'}
                      </td>
                      <td
                        className="px-3.5 py-3 text-[11px] text-ink-mid max-w-xs truncate"
                        title={log.error_message ?? undefined}
                      >
                        {log.error_message ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-[10px] text-ink-muted mt-2 italic">Affichage des 50 dernières lignes sur la période.</p>
        </section>

        {/* Section Automatisations */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="fxs-section-title text-ink">Automatisations</h2>
            <div className="flex gap-1">
              <FilterLink href={buildHref({ auto_status: 'all' })} active={autoStatusActive === 'all'}>Tous</FilterLink>
              <FilterLink href={buildHref({ auto_status: 'success' })} active={autoStatusActive === 'success'}>Réussis</FilterLink>
              <FilterLink href={buildHref({ auto_status: 'failed' })} active={autoStatusActive === 'failed'}>Échecs</FilterLink>
            </div>
          </div>

          {autoJobs.length === 0 ? (
            <p className="text-xs text-ink-muted bg-cream border border-sand-border rounded-lg p-4 text-center">
              Aucun job d'automatisation sur ce filtre.
            </p>
          ) : (
            <div className="bg-cream rounded-xl border border-sand-border overflow-hidden">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-sand">
                    {['Quand', 'Automatisation', 'Action', 'Statut', 'Intervention', 'Erreur'].map((h) => (
                      <th key={h} className="px-3.5 py-2.5 text-left text-[10px] font-bold text-ink-muted uppercase tracking-wider border-b border-sand-border whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {autoJobs.map((job) => (
                    <tr key={job.id} className="border-b border-sand-mid hover:bg-sand-hover">
                      <td className="px-3.5 py-3 text-[11px] text-ink-mid font-mono whitespace-nowrap">{fmtDateTime(job.executed_at)}</td>
                      <td className="px-3.5 py-3 text-[12px] font-mono">{job.automation_name}</td>
                      <td className="px-3.5 py-3">
                        {job.action ? (
                          <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-100 text-gray-700">
                            {job.action}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-3.5 py-3"><StatusBadge status={job.status} /></td>
                      <td className="px-3.5 py-3 text-[11px]">
                        {job.intervention_id ? (
                          <Link href={`/admin/interventions/${job.intervention_id}`} className="font-mono text-navy hover:underline">
                            {job.intervention_id.slice(0, 8)}
                          </Link>
                        ) : '—'}
                      </td>
                      <td
                        className="px-3.5 py-3 text-[11px] text-ink-mid max-w-xs truncate"
                        title={job.error_message ?? undefined}
                      >
                        {job.error_message ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-[10px] text-ink-muted mt-2 italic">Affichage des 50 dernières lignes sur la période.</p>
        </section>

        {/* Section Erreurs cron mails (lot E) — détail texte depuis sms_logs */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="fxs-section-title text-ink">Erreurs cron mails</h2>
            <span className="text-[10px] text-ink-muted">{cronErrors.length} récente(s)</span>
          </div>

          {cronErrors.length === 0 ? (
            <p className="text-xs text-ink-muted bg-cream border border-sand-border rounded-lg p-4 text-center">
              Aucune erreur du cron mails sur la période.
            </p>
          ) : (
            <div className="bg-cream rounded-xl border border-sand-border overflow-hidden">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-sand">
                    {['Quand', 'Sujet', 'Erreur'].map((h) => (
                      <th key={h} className="px-3.5 py-2.5 text-left text-[10px] font-bold text-ink-muted uppercase tracking-wider border-b border-sand-border whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cronErrors.map((e) => {
                    // message = "[error] <sujet>" → on retire le préfixe d'action.
                    const sujet = (e.message ?? '').replace(/^\[[^\]]*\]\s*/, '') || '—';
                    return (
                      <tr key={e.id} className="border-b border-sand-mid hover:bg-sand-hover">
                        <td className="px-3.5 py-3 text-[11px] text-ink-mid font-mono whitespace-nowrap">{fmtDateTime(e.created_at)}</td>
                        <td className="px-3.5 py-3 text-[12px] max-w-[200px] truncate" title={sujet}>{sujet}</td>
                        <td className="px-3.5 py-3 text-[11px] text-terra max-w-md break-words" title={e.error ?? undefined}>
                          {e.error ?? '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-[10px] text-ink-muted mt-2 italic">
            Source : <code>sms_logs</code> (<code>sent_by=cron:check-mails</code>, <code>status=failed</code>). 20 dernières sur la période.
          </p>
        </section>
      </div>
    </>
  );
}

function KpiCard({ label, value, accent }: { label: string; value: string; accent?: 'red' | 'neutral' }) {
  const valueCls = accent === 'red' ? 'text-2xl font-bold text-[var(--color-terra)]' : 'text-2xl font-bold text-ink';
  return (
    <div className="bg-cream rounded-xl border border-sand-border p-4">
      <div className="text-[10px] font-bold text-ink-muted uppercase tracking-wider mb-1">{label}</div>
      <div className={valueCls}>{value}</div>
    </div>
  );
}
