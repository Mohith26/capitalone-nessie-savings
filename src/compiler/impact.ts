import type { RuleDsl } from "../dsl/schema";
import { computeRawTransferAmount, ruleMatchesPurchase, type PurchaseEvent } from "../engine/matching";

export interface ImpactHistoryContext {
  /** Full purchase history available for projection (any window length). */
  purchases: PurchaseEvent[];
  /** How many months of history `purchases` spans (for normalizing to a monthly rate). */
  historyMonths: number;
  monthlyIncomeCents: number;
  currentCheckingBalanceCents: number;
}

const AVG_WEEKS_PER_MONTH = 4.345;

/**
 * Deterministic projection of "if this rule had been active, how much would it have
 * moved into savings per month" -- computed straight from the seeded history, never
 * from an LLM guess. This is what gets shown to the user before they activate a rule.
 */
export function projectMonthlyImpactCents(rule: RuleDsl, ctx: ImpactHistoryContext): number {
  switch (rule.trigger.type) {
    case "purchase": {
      let total = 0;
      for (const purchase of ctx.purchases) {
        if (ruleMatchesPurchase(rule, purchase, ctx.currentCheckingBalanceCents)) {
          total += computeRawTransferAmount(rule, purchase);
        }
      }
      const months = Math.max(ctx.historyMonths, 1 / 30); // avoid div-by-zero on empty history
      return Math.round(total / months);
    }
    case "deposit": {
      if (rule.action.type !== "percent_of_deposit") return 0;
      return Math.round(ctx.monthlyIncomeCents * (rule.action.percent / 100));
    }
    case "schedule": {
      if (rule.action.type !== "fixed_transfer") return 0;
      const occurrencesPerMonth = AVG_WEEKS_PER_MONTH; // this weekday happens ~once/week
      return Math.round(rule.action.amountCents * occurrencesPerMonth);
    }
  }
}
