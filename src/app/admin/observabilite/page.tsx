import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { fmtDateTime } from '@/lib/format';
import type { AgentLog, AutomationJob } from '@/lib/types/database';

export const dynamic = 'force-dynamic';

// URL filtres (valeurs DB littérales) :
//   ?agent=<triage_mail|analyse_pj|rapport>&agent_status=<success|error|partial|all>
//   ?automation=<check_mails|rappel_j1|renew_calendar_watch>&auto_status=<success|failed|skipped|all>
// NB DB : agent_logs.status utilise 'error' (pas 'failed'), automation_jobs
// utilise 'failed'. Le lien "Échecs" sous chaque tableau pointe sur la
// valeur DB correspondante.

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

// Lien de filtre : actif → fond navy-pale + navy gras ; inactif → ink-muted.
function FilterLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  const base = 'px-2.5 py-1 rounded-md text-xs transition-colors';
  const cls = active
    ? `${base} bg-navy-pale text-navy font-semibold`
    : `${base} text-ink-muted hover:text-ink hover:bg-sand-mid`;
  return <Link href={href} className={cls}>{children}</Link>;
}

// Normalise un searchParam Next 16 (qui peut être string | string[] | undefined)
// en string | undefined — on prend la 1re valeur si tableau.
function param(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

type SearchParamsRaw = {
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
  const agentFilter = param(sp.agent);
  const agentStatus = param(sp.agent_status);
  const automationFilter = param(sp.automation);
  const autoStatus = param(sp.auto_status);

  const supabase = await createClient();
  const cutoff24h = new Date(Date.now() - 24 * 3600_000).toISOString();

  // Tableau agents — filtres URL appliqués si présents.
  let agentLogsQuery = supabase
    .from('agent_logs')
    .select('id, agent_name, intervention_id, email_id, input_summary, output_summary, model_used, tokens_input, tokens_output, cost_eur_cents, duration_ms, status, error_message, confidence_score, created_at')
    .order('created_at', { ascending: false })
    .limit(50);
  if (agentFilter && agentFilter !== 'all') {
    agentLogsQuery = agentLogsQuery.eq('agent_name', agentFilter);
  }
  if (agentStatus && agentStatus !== 'all') {
    agentLogsQuery = agentLogsQuery.eq('status', agentStatus);
  }

  // Tableau automations — filtres URL appliqués si présents.
  let autoJobsQuery = supabase
    .from('automation_jobs')
    .select('id, automation_name, intervention_id, action, result, status, error_message, executed_at')
    .order('executed_at', { ascending: false })
    .limit(50);
  if (automationFilter && automationFilter !== 'all') {
    autoJobsQuery = autoJobsQuery.eq('automation_name', automationFilter);
  }
  if (autoStatus && autoStatus !== 'all') {
    autoJobsQuery = autoJobsQuery.eq('status', autoStatus);
  }

  // 4 requêtes parallèles : 2 datasets KPI 24h + 2 tableaux filtrés.
  // Les KPIs sont réduits côté JS (PostgREST ne supporte pas SUM nativement
  // sans RPC, et fetch les rows reste cheap sur 24h).
  const [kpiAgentsRes, kpiAutosRes, agentLogsRes, autoJobsRes] = await Promise.all([
    supabase
      .from('agent_logs')
      .select('status, cost_eur_cents')
      .gte('created_at', cutoff24h),
    supabase
      .from('automation_jobs')
      .select('status')
      .gte('executed_at', cutoff24h),
    agentLogsQuery,
    autoJobsQuery,
  ]);

  const kpiAgents = (kpiAgentsRes.data ?? []) as { status: string; cost_eur_cents: number | null }[];
  const kpiAutos = (kpiAutosRes.data ?? []) as { status: string }[];

  const agentTotal = kpiAgents.length;
  const agentErrors = kpiAgents.filter((r) => r.status !== 'success').length;
  const agentErrorRate = agentTotal === 0 ? 0 : Math.round((agentErrors / agentTotal) * 100);
  const agentCostCents = kpiAgents.reduce((sum, r) => sum + (r.cost_eur_cents ?? 0), 0);

  const autoTotal = kpiAutos.length;
  const autoFailed = kpiAutos.filter((r) => r.status === 'failed').length;
  const autoFailedRate = autoTotal === 0 ? 0 : Math.round((autoFailed / autoTotal) * 100);

  const agentLogs = (agentLogsRes.data ?? []) as AgentLog[];
  const autoJobs = (autoJobsRes.data ?? []) as AutomationJob[];

  // Helpers de construction d'URL préservant les autres params.
  function buildHref(overrides: Partial<{ agent: string; agent_status: string; automation: string; auto_status: string }>): string {
    const params = new URLSearchParams();
    const merged = {
      agent: 'agent' in overrides ? overrides.agent : agentFilter,
      agent_status: 'agent_status' in overrides ? overrides.agent_status : agentStatus,
      automation: 'automation' in overrides ? overrides.automation : automationFilter,
      auto_status: 'auto_status' in overrides ? overrides.auto_status : autoStatus,
    };
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
            Fenêtre 24h • {agentTotal} appels agents • {autoTotal} jobs autos
          </div>
        </div>
      </div>

      <div className="space-y-6">
        {/* Bandeau KPI */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard label="Appels agents 24h" value={String(agentTotal)} />
          <KpiCard label="Taux erreur agents 24h" value={`${agentErrorRate}%`} accent={agentErrorRate > 10 ? 'red' : 'neutral'} />
          <KpiCard label="Coût agents 24h" value={fmtCostEur(agentCostCents)} />
          <KpiCard label="Taux failed autos 24h" value={`${autoFailedRate}%`} accent={autoFailedRate > 10 ? 'red' : 'neutral'} />
        </div>

        {/* Section Agents IA */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-bold text-ink">Agents IA</h2>
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
                    {['Quand', 'Agent', 'Modèle', 'Statut', 'Tokens in/out', 'Coût', 'Durée', 'Intervention', 'Erreur'].map((h) => (
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
          <p className="text-[10px] text-ink-muted mt-2 italic">Affichage des 50 dernières lignes.</p>
        </section>

        {/* Section Automatisations */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-bold text-ink">Automatisations</h2>
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
          <p className="text-[10px] text-ink-muted mt-2 italic">Affichage des 50 dernières lignes.</p>
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
