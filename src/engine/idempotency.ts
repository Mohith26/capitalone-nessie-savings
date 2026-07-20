import { createHash } from "node:crypto";

/**
 * Idempotency key = a deterministic hash of (ruleId, triggeringTransactionId).
 * Re-processing the exact same (rule, transaction) pair -- e.g. on retry, replay,
 * or crash-recovery -- always yields the same key, which is what makes "zero
 * duplicate transfers" provable rather than just likely.
 */
export function idempotencyKeyFor(ruleId: string, triggeringTransactionId: string): string {
  return createHash("sha256").update(`${ruleId}:${triggeringTransactionId}`).digest("hex");
}
