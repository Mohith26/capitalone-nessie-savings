import type { Action } from "../dsl/schema";

/**
 * Safety-rail NUMBERS are always assigned by this deterministic code, never by the
 * LLM -- the model proposes trigger/conditions/action (the "what"), and this module
 * decides the "how safe" (balance floor + daily cap), consistent with never letting
 * free-text generation own a risk-critical number.
 */
export const DEFAULT_BALANCE_FLOOR_CENTS = 2500; // never let checking go below $25

export function defaultDailyCapCentsForAction(action: Action): number {
  switch (action.type) {
    case "round_up":
      // Round-ups are small and frequent; cap generously but boundedly.
      return 3000; // $30/day
    case "fixed_transfer":
      // Never let a repeated fixed transfer exceed 5x itself in one day, and never
      // more than $200/day regardless of the requested per-trigger amount.
      return Math.min(action.amountCents * 5, 20000);
    case "percent_of_deposit":
      // Deposits are infrequent (paychecks), so a higher absolute cap is safe.
      return 50000; // $500/day
  }
}
