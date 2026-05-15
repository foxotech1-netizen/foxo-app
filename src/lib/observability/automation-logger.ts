/**
 * src/lib/observability/automation-logger.ts
 *
 * Wrapper d'observabilité pour les crons / jobs d'automatisation
 * (check-mails, rappel-j1, renew-calendar-watch, etc.). Insère une ligne
 * dans `automation_jobs` avec statut + résultat.
 *
 * Pattern symétrique à `runAgent` mais sans tracking de tokens/coût.
 * Générique sur le type d'output renvoyé au caller (cf. modif 5b1).
 */

import { createAdminClient } from "@/lib/supabase/admin";

export type AutomationStatus = "success" | "failed" | "skipped";

export type AutomationRunInput<TOutput> = {
  /** Nom du job, texte libre (pas de CHECK strict en DB). */
  automationName: string;
  /** UUID intervention si applicable (override possible via run()). */
  interventionId?: string | null;
  /** Action réalisée (texte libre, ex: "sent_sms", "renewed_watch"). */
  action?: string | null;
  /**
   * Fonction qui exécute la logique du cron / job et renvoie :
   *  - `output` : la valeur applicative renvoyée au caller (générique <TOutput>)
   *  - `result` : résumé jsonb persisté en automation_jobs.result
   *  - optionnel `status` : override du statut par défaut "success"
   *    (ex: "skipped" si le job a court-circuité légitimement)
   *  - optionnel `interventionId` : OVERRIDE quand connu seulement après le run.
   */
  run: () => Promise<{
    output: TOutput;
    result: Record<string, unknown>;
    status?: AutomationStatus;
    interventionId?: string | null;
  }>;
};

export type AutomationRunResult<TOutput> = {
  output: TOutput;
  /** ID de la ligne créée dans automation_jobs (chaîne vide si insertion échouée). */
  logId: string;
  /** Durée totale du run en millisecondes. */
  durationMs: number;
  /** Statut final tel que persisté. */
  status: AutomationStatus;
};

export async function logAutomationJob<TOutput>(
  input: AutomationRunInput<TOutput>,
): Promise<AutomationRunResult<TOutput>> {
  const supabase = createAdminClient();
  const startedAt = Date.now();

  let status: AutomationStatus = "success";
  let errorMessage: string | null = null;
  let result: Record<string, unknown> = {};
  let output: TOutput | undefined;
  let finalInterventionId: string | null | undefined = input.interventionId;

  try {
    const r = await input.run();
    output = r.output;
    result = r.result;
    if (r.status)                       status = r.status;
    if (r.interventionId !== undefined) finalInterventionId = r.interventionId;
  } catch (err) {
    status = "failed";
    errorMessage = err instanceof Error ? err.message : String(err);
  }

  const durationMs = Date.now() - startedAt;

  const { data, error: insertError } = await supabase
    .from("automation_jobs")
    .insert({
      automation_name: input.automationName,
      intervention_id: finalInterventionId ?? null,
      action:          input.action ?? null,
      result,
      status,
      error_message:   errorMessage,
    })
    .select("id")
    .single();

  if (insertError) {
    console.error(
      "[observability/automation-logger] insertion automation_jobs échouée:",
      insertError,
    );
  }

  if (status === "failed") {
    throw new Error(errorMessage ?? "automation run failed");
  }

  return {
    output: output as TOutput,
    logId: data?.id ?? "",
    durationMs,
    status,
  };
}
