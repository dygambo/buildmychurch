import { naira } from "./format";

/** Where a memo approval step's starting amount comes from. */
export const STEP_SOURCES = ["amount", "finance_limit"] as const;
export type StepSource = (typeof STEP_SOURCES)[number];

/** When a step applies: to every memo, from a set amount, or above the finance approval limit. */
export type StepRule = { kind: "always" } | { kind: "from"; kobo: number } | { kind: "above"; kobo: number };

export function stepRule(step: { minAmountKobo: number; minSource: StepSource }, financeLimitKobo: number): StepRule {
  if (step.minSource === "finance_limit") return { kind: "above", kobo: financeLimitKobo };
  return step.minAmountKobo > 0 ? { kind: "from", kobo: step.minAmountKobo } : { kind: "always" };
}

export function ruleApplies(rule: StepRule, amountKobo: number | null | undefined): boolean {
  const k = amountKobo ?? 0;
  if (rule.kind === "always") return true;
  if (rule.kind === "from") return k >= rule.kobo;
  return k > rule.kobo;
}

/** "from ₦50,000", "above ₦50,000", or "" for every memo. */
export function ruleText(rule: StepRule): string {
  if (rule.kind === "always") return "";
  return `${rule.kind} ${naira(rule.kobo)}`;
}
