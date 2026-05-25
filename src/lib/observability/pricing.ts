/**
 * src/lib/observability/pricing.ts
 *
 * Tarification estimée des modèles Anthropic, exprimée en CENTIMES EUR par
 * MILLION de tokens. Utilisé par agent-logger pour calculer cost_eur_cents.
 *
 * Source : tarifs publics Anthropic (docs.anthropic.com/en/docs/about-claude/pricing)
 * convertis USD → EUR à un taux d'environ 0.92 (à ajuster).
 *
 * TODO : vérifier les valeurs réelles et le taux de change à jour, puis
 * mettre à jour cette table. Les chiffres ci-dessous sont des estimations
 * raisonnables, suffisantes pour un suivi de coût d'ordre de grandeur mais
 * pas pour de la comptabilité fine.
 */

export type Pricing = {
  /** Centimes EUR par 1 000 000 tokens d'entrée. */
  input: number;
  /** Centimes EUR par 1 000 000 tokens de sortie. */
  output: number;
};

/**
 * Indexé par la chaîne `model_used` qui sera loggée dans `agent_logs.model_used`.
 * Inclure à la fois les alias courts (`claude-sonnet-4-6`) et les chaînes
 * datées (`claude-haiku-4-5-20251001`) quand elles existent côté SDK.
 */
export const MODEL_PRICING: Record<string, Pricing> = {
  // Opus 4.7  — $15 / $75 par M tokens
  "claude-opus-4-7":             { input: 1380, output: 6900 },
  // Opus 4.6  — $15 / $75 par M tokens
  "claude-opus-4-6":             { input: 1380, output: 6900 },
  // Sonnet 4.6 — $3  / $15 par M tokens
  "claude-sonnet-4-6":           { input:  276, output: 1380 },
  // Sonnet 4 (daté 2025-05-14) — même tarif que Sonnet 4.6
  "claude-sonnet-4-20250514":    { input:  276, output: 1380 },
  // Haiku 4.5 — $0.80 / $4 par M tokens
  "claude-haiku-4-5":            { input:   74, output:  368 },
  "claude-haiku-4-5-20251001":   { input:   74, output:  368 },
};

/**
 * Calcule le coût estimé en centimes EUR (arrondi à l'entier) d'un appel LLM.
 * Si le modèle est inconnu de MODEL_PRICING, logge un warning et renvoie 0
 * (dégradation gracieuse — le log agent_logs sera quand même créé).
 */
export function estimateCostEurCents(
  model: string,
  tokensInput: number,
  tokensOutput: number,
): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) {
    console.warn(
      `[observability/pricing] modèle inconnu "${model}", cost_eur_cents=0`,
    );
    return 0;
  }
  const inputCost  = (pricing.input  * tokensInput)  / 1_000_000;
  const outputCost = (pricing.output * tokensOutput) / 1_000_000;
  return Math.round(inputCost + outputCost);
}
