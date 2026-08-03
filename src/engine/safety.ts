import type { RuleDsl } from "../dsl/schema";

export interface SafetyCheckInput {
  rule: RuleDsl;
  proposedAmountCents: number;
  currentCheckingBalanceCents: number;
  alreadyTransferredTodayCents: number; // sum of this rule's transfers already executed today
}

export type SafetyCheckResult =
  | { allowed: true; amountCents: number }
  | { allowed: false; reason: "non_positive_amount" | "balance_floor_violation" | "daily_cap_exceeded" };

/**
 * Hard safety rails, enforced at EXECUTION time (not just DSL-validation time),
 * because balance and daily-spend are runtime state that can change between when a
 * rule is created and when it fires. These three checks are what "no negative
 * transfers", "balance floor always enforced", and "daily transfer cap" mean in
 * practice, and they run on every single transfer attempt, no exceptions.
 */
export function checkSafetyRails(input: SafetyCheckInput): SafetyCheckResult {
  const { rule, proposedAmountCents, currentCheckingBalanceCents, alreadyTransferredTodayCents } = input;

  if (!Number.isInteger(proposedAmountCents) || proposedAmountCents <= 0) {
    return { allowed: false, reason: "non_positive_amount" };
  }

  const resultingBalance = currentCheckingBalanceCents - proposedAmountCents;
  if (resultingBalance < rule.safety.balanceFloorCents) {
    return { allowed: false, reason: "balance_floor_violation" };
  }

  const dailyTotalAfter = alreadyTransferredTodayCents + proposedAmountCents;
  if (dailyTotalAfter > rule.safety.dailyCapCents) {
    return { allowed: false, reason: "daily_cap_exceeded" };
  }

  return { allowed: true, amountCents: proposedAmountCents };
}
