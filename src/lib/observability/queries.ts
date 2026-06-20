import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Liste exhaustive des agents attendus dans agent_logs.
 * Doit rester en phase avec l'union TS `AgentName` et le CHECK SQL.
 * Le dashboard affiche TOUS ces agents même quand un agent n'a aucun log
 * sur la période demandée (compteur 0).
 */
export const ALL_AGENT_NAMES = [
  // canoniques
  "triage_mail",
  "analyse_pj",
  "rapport",
  "analyse_photo",
  // utilitaires
  "draft_reply",
  "sms_compose",
  "notes_frais_extract",
  "assistant_chat",
  "briefing",
  "synthese_essentiel",
] as const;

export type AgentNameKnown = (typeof ALL_AGENT_NAMES)[number];
export type AgentKind = "canonical" | "utility";

export const AGENT_KIND_BY_NAME: Record<AgentNameKnown, AgentKind> = {
  triage_mail: "canonical",
  analyse_pj: "canonical",
  rapport: "canonical",
  analyse_photo: "canonical",
  draft_reply: "utility",
  sms_compose: "utility",
  notes_frais_extract: "utility",
  assistant_chat: "utility",
  briefing: "utility",
  synthese_essentiel: "utility",
};

export type ObservabilityPeriod = "7d" | "30d" | "90d" | "all";

export function periodToIntervalIso(period: ObservabilityPeriod): string | null {
  switch (period) {
    case "7d":
      return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    case "30d":
      return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    case "90d":
      return new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    case "all":
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* Stats agrégées                                                      */
/* ------------------------------------------------------------------ */

export interface AgentStatsRow {
  agent_name: AgentNameKnown | string; // string en secours si un nouvel agent apparaît hors enum
  agent_kind: AgentKind;
  nb_calls: number;
  nb_errors: number;
  total_cost_eur_cents: number;
  avg_duration_ms: number | null;
}

export interface ObservabilityStats {
  period: ObservabilityPeriod;
  total_calls: number;
  total_errors: number;
  total_cost_eur_cents: number;
  avg_duration_ms: number | null;
  by_agent: AgentStatsRow[];
}

/**
 * Charge les stats agrégées sur la période demandée.
 *
 * Implémentation : on tire toutes les lignes nécessaires de agent_logs
 * via createAdminClient (pas de RLS) et on agrège côté JS. Tant que le
 * volume reste petit (<10k lignes/période), c'est plus simple et plus
 * lisible qu'une RPC SQL. Si le volume explose plus tard, on basculera
 * vers une RPC SQL avec GROUP BY.
 */
export async function getObservabilityStats(
  period: ObservabilityPeriod = "7d",
): Promise<ObservabilityStats> {
  const supabase = createAdminClient();
  const sinceIso = periodToIntervalIso(period);

  let query = supabase
    .from("agent_logs")
    .select("agent_name, agent_kind, status, cost_eur_cents, duration_ms");

  if (sinceIso) {
    query = query.gte("created_at", sinceIso);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`getObservabilityStats: ${error.message}`);
  }

  const rows = data ?? [];

  // Agrégation par agent
  const byAgentMap = new Map<
    string,
    {
      agent_name: string;
      agent_kind: AgentKind;
      nb_calls: number;
      nb_errors: number;
      total_cost_eur_cents: number;
      sum_duration_ms: number;
      nb_duration_samples: number;
    }
  >();

  let total_calls = 0;
  let total_errors = 0;
  let total_cost_eur_cents = 0;
  let sum_duration_ms = 0;
  let nb_duration_samples = 0;

  for (const row of rows) {
    const name = row.agent_name as string;
    const kind = (row.agent_kind as AgentKind) ?? "canonical";
    const isError = row.status === "error";
    const cost = row.cost_eur_cents ?? 0;
    const duration = row.duration_ms;

    total_calls += 1;
    if (isError) total_errors += 1;
    total_cost_eur_cents += cost;
    if (typeof duration === "number") {
      sum_duration_ms += duration;
      nb_duration_samples += 1;
    }

    const existing = byAgentMap.get(name) ?? {
      agent_name: name,
      agent_kind: kind,
      nb_calls: 0,
      nb_errors: 0,
      total_cost_eur_cents: 0,
      sum_duration_ms: 0,
      nb_duration_samples: 0,
    };
    existing.nb_calls += 1;
    if (isError) existing.nb_errors += 1;
    existing.total_cost_eur_cents += cost;
    if (typeof duration === "number") {
      existing.sum_duration_ms += duration;
      existing.nb_duration_samples += 1;
    }
    byAgentMap.set(name, existing);
  }

  // Garantit que TOUS les agents connus apparaissent, même à 0 (UI lisible)
  for (const known of ALL_AGENT_NAMES) {
    if (!byAgentMap.has(known)) {
      byAgentMap.set(known, {
        agent_name: known,
        agent_kind: AGENT_KIND_BY_NAME[known],
        nb_calls: 0,
        nb_errors: 0,
        total_cost_eur_cents: 0,
        sum_duration_ms: 0,
        nb_duration_samples: 0,
      });
    }
  }

  const by_agent: AgentStatsRow[] = Array.from(byAgentMap.values())
    .map((a) => ({
      agent_name: a.agent_name,
      agent_kind: a.agent_kind,
      nb_calls: a.nb_calls,
      nb_errors: a.nb_errors,
      total_cost_eur_cents: a.total_cost_eur_cents,
      avg_duration_ms:
        a.nb_duration_samples > 0
          ? Math.round(a.sum_duration_ms / a.nb_duration_samples)
          : null,
    }))
    .sort((a, b) => {
      // canonical d'abord, puis ordre alpha à l'intérieur
      if (a.agent_kind !== b.agent_kind) {
        return a.agent_kind === "canonical" ? -1 : 1;
      }
      return a.agent_name.localeCompare(b.agent_name);
    });

  return {
    period,
    total_calls,
    total_errors,
    total_cost_eur_cents,
    avg_duration_ms:
      nb_duration_samples > 0
        ? Math.round(sum_duration_ms / nb_duration_samples)
        : null,
    by_agent,
  };
}

/* ------------------------------------------------------------------ */
/* Liste paginée des logs                                              */
/* ------------------------------------------------------------------ */

export interface AgentLogRow {
  id: string;
  agent_name: string;
  agent_kind: AgentKind;
  model_used: string;
  status: string;
  tokens_input: number | null;
  tokens_output: number | null;
  cost_eur_cents: number | null;
  duration_ms: number | null;
  confidence_score: number | null;
  error_message: string | null;
  intervention_id: string | null;
  email_id: string | null;
  created_at: string;
}

export interface AgentLogsListOptions {
  period?: ObservabilityPeriod;
  agentName?: string; // filtrer par un seul agent
  statusFilter?: "all" | "success" | "error";
  page?: number; // 1-indexed
  pageSize?: number; // défaut 50
}

export interface AgentLogsListResult {
  rows: AgentLogRow[];
  page: number;
  pageSize: number;
  totalCount: number;
}

export async function getAgentLogsList(
  options: AgentLogsListOptions = {},
): Promise<AgentLogsListResult> {
  const period = options.period ?? "7d";
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, options.pageSize ?? 50));
  const sinceIso = periodToIntervalIso(period);
  const supabase = createAdminClient();

  let query = supabase
    .from("agent_logs")
    .select(
      "id, agent_name, agent_kind, model_used, status, tokens_input, tokens_output, cost_eur_cents, duration_ms, confidence_score, error_message, intervention_id, email_id, created_at",
      { count: "exact" },
    )
    .order("created_at", { ascending: false });

  if (sinceIso) {
    query = query.gte("created_at", sinceIso);
  }
  if (options.agentName && options.agentName !== "all") {
    query = query.eq("agent_name", options.agentName);
  }
  if (options.statusFilter && options.statusFilter !== "all") {
    query = query.eq("status", options.statusFilter);
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  query = query.range(from, to);

  const { data, error, count } = await query;
  if (error) {
    throw new Error(`getAgentLogsList: ${error.message}`);
  }

  return {
    rows: (data ?? []) as AgentLogRow[],
    page,
    pageSize,
    totalCount: count ?? 0,
  };
}
