import { z } from "zod";

/**
 * The savings-rule DSL. Every rule is one JSON object matching this schema:
 * a trigger, zero or more conditions (AND-ed together), one action, and a
 * `safety` block that is ALWAYS present and ALWAYS enforced by the engine
 * regardless of what the trigger/action say (see src/engine/safety.ts).
 *
 * Money is always an integer number of cents -- never a float -- per the
 * "money as integers" fintech-correctness requirement in the spec.
 */

const centsInt = z.number().int();
const positiveCentsInt = centsInt.positive();
const nonNegativeCentsInt = centsInt.nonnegative();

export const MERCHANT_CATEGORY = z.enum([
  "coffee",
  "groceries",
  "restaurants",
  "rideshare",
  "entertainment",
  "utilities",
  "rent",
  "shopping",
  "subscriptions",
  "gas",
]);
export type MerchantCategory = z.infer<typeof MERCHANT_CATEGORY>;

export const TriggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("purchase") }),
  z.object({ type: z.literal("deposit") }),
  z.object({
    type: z.literal("schedule"),
    // simple weekly cadence, e.g. "weekly" on a given ISO weekday (0=Sun..6=Sat)
    weekday: z.number().int().min(0).max(6),
  }),
]);
export type Trigger = z.infer<typeof TriggerSchema>;

export const ConditionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("merchant_category"), categories: z.array(MERCHANT_CATEGORY).min(1) }),
  z.object({
    type: z.literal("amount_range"),
    minCents: nonNegativeCentsInt.optional(),
    maxCents: positiveCentsInt.optional(),
  }),
  z.object({ type: z.literal("balance_floor"), minCents: nonNegativeCentsInt }),
]);
export type Condition = z.infer<typeof ConditionSchema>;

export const ActionSchema = z.discriminatedUnion("type", [
  // Round the triggering purchase up to the nearest multiple of `toCents` and
  // transfer the difference. toCents must be a "clean" round-up denomination.
  z.object({ type: z.literal("round_up"), toCents: z.union([z.literal(100), z.literal(500), z.literal(1000)]) }),
  z.object({ type: z.literal("fixed_transfer"), amountCents: positiveCentsInt }),
  // Only valid when the rule's trigger is "deposit".
  z.object({ type: z.literal("percent_of_deposit"), percent: z.number().positive().max(100) }),
]);
export type Action = z.infer<typeof ActionSchema>;

export const SafetyRailsSchema = z.object({
  balanceFloorCents: nonNegativeCentsInt.default(0),
  dailyCapCents: positiveCentsInt,
});
export type SafetyRails = z.infer<typeof SafetyRailsSchema>;

export const RuleDslSchema = z
  .object({
    trigger: TriggerSchema,
    conditions: z.array(ConditionSchema).default([]),
    action: ActionSchema,
    safety: SafetyRailsSchema,
  })
  .superRefine((rule, ctx) => {
    if (rule.action.type === "percent_of_deposit" && rule.trigger.type !== "deposit") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "percent_of_deposit action requires a deposit trigger",
        path: ["action"],
      });
    }
    if (
      (rule.action.type === "round_up" || rule.action.type === "fixed_transfer") &&
      rule.trigger.type === "deposit"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${rule.action.type} action does not apply to a deposit trigger`,
        path: ["action"],
      });
    }
    if (rule.action.type === "fixed_transfer" && rule.action.amountCents > rule.safety.dailyCapCents) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "fixed_transfer amount cannot exceed the rule's own daily cap",
        path: ["action", "amountCents"],
      });
    }
    for (const condition of rule.conditions) {
      if (condition.type === "amount_range" && condition.minCents !== undefined && condition.maxCents !== undefined) {
        if (condition.minCents > condition.maxCents) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "amount_range minCents cannot exceed maxCents",
            path: ["conditions"],
          });
        }
      }
      if (condition.type === "balance_floor" && condition.minCents > rule.safety.dailyCapCents * 1000) {
        // sanity guard against absurd floors that would never be satisfiable
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "balance_floor condition is implausibly large",
          path: ["conditions"],
        });
      }
    }
  });
export type RuleDsl = z.infer<typeof RuleDslSchema>;

export interface DslValidationResult {
  ok: boolean;
  rule?: RuleDsl;
  errors?: string[];
}

export function validateRuleDsl(input: unknown): DslValidationResult {
  const parsed = RuleDslSchema.safeParse(input);
  if (parsed.success) return { ok: true, rule: parsed.data };
  return {
    ok: false,
    errors: parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
  };
}
