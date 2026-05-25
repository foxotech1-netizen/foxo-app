/**
 * src/lib/observability/agent-logger.ts
 *
 * Wrapper d'observabilité pour tous les appels Anthropic. Mesure tokens /
 * coût / durée, insère une ligne dans `agent_logs`, et propage l'output au
 * caller.
 *
 * Deux familles d'agents (cf. agent_kind) :
 *  - canonical : Triage Mail, Analyse PJ, Rapport (doc 03). Objectif 99%
 *    précision, alertes si dérive.
 *  - utility   : agents utilitaires (rédaction SMS, brouillons de mail,
 *    extraction notes de frais, assistant chat admin). Monitoring de coût
 *    et de fiabilité, pas d'objectif de précision strict.
 *
 * Règle non-négociable (doc 02 §10) : TOUT appel Anthropic depuis le code
 * applicatif DOIT passer par `runAgent`. Aucune exception.
 *
 * RGPD (doc 02 §8) : `inputSummary` et `outputSummary` doivent être SANS PII
 * (pas de from, sujet brut, body, noms, adresses). Le caller est responsable
 * de produire des résumés non-sensibles avant d'appeler `runAgent`.
 *
 * JSON parse fail : si le run() doit parser un JSON depuis la réponse
 * Anthropic, il DOIT capter l'erreur localement, prefixer "JSON parse: <msg>
 * (preview: <200 chars>)" et re-throw. Le wrapper propagera cette erreur
 * intacte dans `agent_logs.error_message` sans tronquer.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { estimateCostEurCents } from "./pricing";

export type AgentName =
  // Canoniques (doc 03)
  | "triage_mail"
  | "analyse_pj"
  | "rapport"
  // Utilitaires (chantier #7)
  | "draft_reply"
  | "sms_compose"
  | "notes_frais_extract"
  | "assistant_chat";

export type AgentKind = "canonical" | "utility";

/** Forme minimale attendue de la réponse Anthropic pour extraire les tokens. */
type AnthropicUsageEnvelope = {
  usage: { input_tokens: number; output_tokens: number };
};

export type AgentRunInput<TOutput> = {
  agentName: AgentName;
  /**
   * Famille de l'agent (default 'canonical' pour backward-compat).
   * Doit être 'utility' pour les agents utilitaires (sms_compose, draft_reply,
   * notes_frais_extract, assistant_chat).
   */
  agentKind?: AgentKind;
  /** Chaîne modèle telle qu'elle sera loggée en agent_logs.model_used. */
  model: string;
  /** UUID intervention si connu à l'entrée (override possible via run()). */
  interventionId?: string | null;
  /** UUID email si applicable (override possible via run()). */
  emailId?: string | null;
  /** Résumé non-PII des inputs. Loggé tel quel en agent_logs.input_summary. */
  inputSummary: Record<string, unknown>;
  /** Score de confiance [0..1] si connu à l'entrée (override possible). */
  confidenceScore?: number | null;
  /**
   * Fonction qui exécute l'appel Anthropic + tout post-traitement (parsing,
   * matching dossier, etc.) et renvoie :
   *  - `message` : la réponse Anthropic brute (pour extraire usage.{input,output}_tokens)
   *  - `output`  : la valeur applicative renvoyée au caller
   *  - `outputSummary` : résumé non-PII pour agent_logs.output_summary
   *  - optionnel `interventionId` / `emailId` : valeurs OVERRIDE quand connues
   *    seulement après le run (cas Agent 1 CAS A — matching dossier dans le run).
   *  - optionnel `confidenceScore` : valeur calculée pendant le run.
   */
  run: () => Promise<{
    message: AnthropicUsageEnvelope;
    output: TOutput;
    outputSummary: Record<string, unknown>;
    interventionId?: string | null;
    emailId?: string | null;
    confidenceScore?: number | null;
  }>;
};

export type AgentRunResult<TOutput> = {
  output: TOutput;
  /** ID de la ligne créée dans agent_logs (chaîne vide si l'insertion a échoué). */
  logId: string;
  /** Durée totale du run en millisecondes. */
  durationMs: number;
  /** Coût estimé en centimes EUR. */
  costEurCents: number;
  /** Valeur finale loggée (input ou override depuis run()). null si non renseignée. */
  interventionId: string | null;
  /** Valeur finale loggée (input ou override depuis run()). null si non renseignée. */
  emailId: string | null;
  /** Valeur finale loggée (input ou override depuis run()). null si non renseignée. */
  confidenceScore: number | null;
};

export async function runAgent<TOutput>(
  input: AgentRunInput<TOutput>,
): Promise<AgentRunResult<TOutput>> {
  const supabase = createAdminClient();
  const startedAt = Date.now();

  let status: "success" | "partial" | "error" = "success";
  let errorMessage: string | null = null;
  let tokensInput = 0;
  let tokensOutput = 0;
  let outputSummary: Record<string, unknown> = {};
  let output: TOutput | undefined;
  let finalInterventionId: string | null | undefined = input.interventionId;
  let finalEmailId:        string | null | undefined = input.emailId;
  let finalConfidence:     number | null | undefined = input.confidenceScore;

  try {
    const r = await input.run();
    output = r.output;
    outputSummary = r.outputSummary;
    tokensInput  = r.message.usage.input_tokens;
    tokensOutput = r.message.usage.output_tokens;
    if (r.interventionId  !== undefined) finalInterventionId = r.interventionId;
    if (r.emailId         !== undefined) finalEmailId        = r.emailId;
    if (r.confidenceScore !== undefined) finalConfidence     = r.confidenceScore;
  } catch (err) {
    status = "error";
    errorMessage = err instanceof Error ? err.message : String(err);
  }

  const durationMs   = Date.now() - startedAt;
  const costEurCents = estimateCostEurCents(input.model, tokensInput, tokensOutput);

  const { data, error: insertError } = await supabase
    .from("agent_logs")
    .insert({
      agent_name:       input.agentName,
      agent_kind:       input.agentKind ?? "canonical",
      intervention_id:  finalInterventionId ?? null,
      email_id:         finalEmailId ?? null,
      input_summary:    input.inputSummary,
      output_summary:   outputSummary,
      model_used:       input.model,
      tokens_input:     tokensInput,
      tokens_output:    tokensOutput,
      cost_eur_cents:   costEurCents,
      duration_ms:      durationMs,
      status,
      error_message:    errorMessage,
      confidence_score: finalConfidence ?? null,
    })
    .select("id")
    .single();

  if (insertError) {
    console.error(
      "[observability/agent-logger] insertion agent_logs échouée:",
      insertError,
    );
  }

  if (status === "error") {
    throw new Error(errorMessage ?? "agent run failed");
  }

  return {
    output: output as TOutput,
    logId: data?.id ?? "",
    durationMs,
    costEurCents,
    interventionId: finalInterventionId ?? null,
    emailId:        finalEmailId ?? null,
    confidenceScore: finalConfidence ?? null,
  };
}
