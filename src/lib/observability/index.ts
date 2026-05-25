/**
 * src/lib/observability/index.ts
 *
 * Point d'entrée du module observabilité. Re-export public.
 */

export { estimateCostEurCents, MODEL_PRICING } from "./pricing";
export type { Pricing } from "./pricing";

export { runAgent } from "./agent-logger";
export type {
  AgentName,
  AgentKind,
  AgentRunInput,
  AgentRunResult,
} from "./agent-logger";

export { logAutomationJob } from "./automation-logger";
export type {
  AutomationRunInput,
  AutomationRunResult,
  AutomationStatus,
} from "./automation-logger";

export * from "./queries";
