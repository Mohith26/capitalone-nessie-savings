/**
 * Deterministic, keyword-level pre-check run BEFORE the request ever reaches the
 * model. This is the first of three independent layers that keep the compiler safe:
 *   1. this heuristic guard (catches "send my whole paycheck" style requests outright)
 *   2. the model's own judgment (asked to refuse anything unsafe/unexpressible)
 *   3. the zod DSL validator + deterministic safety-rail defaults (src/compiler/defaults.ts)
 * A phrase only needs to be caught by ONE layer to be rejected, but layer 1 is what
 * makes the "unsafe request rejected" behavior reproducible regardless of model mood.
 */

const WHOLE_AMOUNT_PATTERNS = [
  /\bwhole\s+paycheck\b/i,
  /\bentire\s+paycheck\b/i,
  /\ball\s+(of\s+)?my\s+(paycheck|income|salary|money|balance|savings)\b/i,
  /\bmy\s+entire\s+(balance|income|salary)\b/i,
  /\b100\s*%\s*of\s+(my\s+)?(paycheck|income|deposit|salary)\b/i,
  /\beverything\s+i\s+(have|earn|make)\b/i,
];

const NEGATIVE_OR_NONSENSE_PATTERNS = [
  /\bnegative\b.*\b(dollar|amount|save)\b/i,
  /\btake\s+money\s+(out|from)\s+savings\b/i, // this is a withdrawal request, not a savings rule
  /\bsend\s+money\s+to\s+(someone|another\s+person|my\s+friend)\b/i, // out of scope: not a savings action
];

export interface GuardResult {
  blocked: boolean;
  reason?: string;
}

export function heuristicSafetyGuard(text: string): GuardResult {
  for (const pattern of WHOLE_AMOUNT_PATTERNS) {
    if (pattern.test(text)) {
      return {
        blocked: true,
        reason:
          "This would sweep your entire paycheck/balance into savings with no cap, which violates the daily " +
          "transfer cap safety rail. Try a percentage (e.g. \"save 10% of every paycheck\") or a fixed amount instead.",
      };
    }
  }
  for (const pattern of NEGATIVE_OR_NONSENSE_PATTERNS) {
    if (pattern.test(text)) {
      return {
        blocked: true,
        reason: "This isn't a savings rule RoundUps can express safely (it either moves money out of savings or to a third party).",
      };
    }
  }
  return { blocked: false };
}
