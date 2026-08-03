import type { RuleDsl } from "../dsl/schema";

export interface RuleMixDefinition {
  name: string;
  description: string;
  rules: RuleDsl[];
}

/**
 * The rule mixes exercised by the 500-customer simulation. Each customer is assigned
 * exactly one mix (round-robin) so we can compare savings outcomes ACROSS mixes, not
 * just across personas.
 */
export const RULE_MIXES: RuleMixDefinition[] = [
  {
    name: "flat_roundup",
    description: "Round every purchase up to the nearest dollar.",
    rules: [
      {
        trigger: { type: "purchase" },
        conditions: [],
        action: { type: "round_up", toCents: 100 },
        safety: { balanceFloorCents: 2500, dailyCapCents: 3000 },
      },
    ],
  },
  {
    name: "coffee_fixed",
    description: "Save a fixed $3 every coffee purchase.",
    rules: [
      {
        trigger: { type: "purchase" },
        conditions: [{ type: "merchant_category", categories: ["coffee"] }],
        action: { type: "fixed_transfer", amountCents: 300 },
        safety: { balanceFloorCents: 2500, dailyCapCents: 1500 },
      },
    ],
  },
  {
    name: "percent_deposit_10",
    description: "Save 10% of every paycheck deposit.",
    rules: [
      {
        trigger: { type: "deposit" },
        conditions: [],
        // Deposits are monthly (a paycheck), not daily, so the daily cap functions
        // more like a per-paycheck ceiling here -- set high enough that even a
        // high_earner persona's 10% ($1,600 on a $16k paycheck) clears it, while
        // still being a real, enforced upper bound (not unbounded).
        action: { type: "percent_of_deposit", percent: 10 },
        safety: { balanceFloorCents: 2500, dailyCapCents: 200000 },
      },
    ],
  },
  {
    name: "combo_roundup_plus_deposit",
    description: "Round up every purchase to the nearest dollar AND save 5% of every deposit.",
    rules: [
      {
        trigger: { type: "purchase" },
        conditions: [],
        action: { type: "round_up", toCents: 100 },
        safety: { balanceFloorCents: 2500, dailyCapCents: 3000 },
      },
      {
        trigger: { type: "deposit" },
        conditions: [],
        action: { type: "percent_of_deposit", percent: 5 },
        safety: { balanceFloorCents: 2500, dailyCapCents: 200000 },
      },
    ],
  },
];

export function ruleMixForIndex(index: number): RuleMixDefinition {
  return RULE_MIXES[index % RULE_MIXES.length];
}
