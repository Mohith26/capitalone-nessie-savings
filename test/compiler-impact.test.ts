import { describe, expect, it } from "vitest";
import { defaultDailyCapCentsForAction, DEFAULT_BALANCE_FLOOR_CENTS } from "../src/compiler/defaults";
import { projectMonthlyImpactCents } from "../src/compiler/impact";
import type { RuleDsl } from "../src/dsl/schema";

describe("defaultDailyCapCentsForAction (safety numbers are code-owned, not LLM-owned)", () => {
  it("caps round_up at $30/day regardless of what the model proposed", () => {
    expect(defaultDailyCapCentsForAction({ type: "round_up", toCents: 100 })).toBe(3000);
  });

  it("caps fixed_transfer at 5x the per-trigger amount, capped at $200/day", () => {
    expect(defaultDailyCapCentsForAction({ type: "fixed_transfer", amountCents: 1000 })).toBe(5000);
    expect(defaultDailyCapCentsForAction({ type: "fixed_transfer", amountCents: 100000 })).toBe(20000); // hits the $200 ceiling
  });

  it("caps percent_of_deposit at $500/day", () => {
    expect(defaultDailyCapCentsForAction({ type: "percent_of_deposit", percent: 50 })).toBe(50000);
  });

  it("balance floor default is a fixed, positive constant", () => {
    expect(DEFAULT_BALANCE_FLOOR_CENTS).toBeGreaterThan(0);
  });
});

describe("projectMonthlyImpactCents", () => {
  const roundUpRule: RuleDsl = {
    trigger: { type: "purchase" },
    conditions: [{ type: "merchant_category", categories: ["coffee"] }],
    action: { type: "round_up", toCents: 100 },
    safety: { balanceFloorCents: 0, dailyCapCents: 3000 },
  };

  it("sums round-up impact only for matching purchases, normalized to a monthly rate", () => {
    const impact = projectMonthlyImpactCents(roundUpRule, {
      purchases: [
        { transactionId: "1", accountId: "a", merchantCategory: "coffee", amountCents: 430, date: "2026-01-01" }, // +70
        { transactionId: "2", accountId: "a", merchantCategory: "coffee", amountCents: 500, date: "2026-01-02" }, // +0 (already round)
        { transactionId: "3", accountId: "a", merchantCategory: "groceries", amountCents: 430, date: "2026-01-03" }, // not matched
      ],
      historyMonths: 1,
      monthlyIncomeCents: 500000,
      currentCheckingBalanceCents: 100000,
    });
    expect(impact).toBe(70);
  });

  it("normalizes by historyMonths so 6 months of data yields a per-month rate", () => {
    const sixMonthsOfSamePurchase = Array.from({ length: 6 }, (_, i) => ({
      transactionId: `p${i}`,
      accountId: "a",
      merchantCategory: "coffee",
      amountCents: 430,
      date: "2026-01-01",
    }));
    const impact = projectMonthlyImpactCents(roundUpRule, {
      purchases: sixMonthsOfSamePurchase,
      historyMonths: 6,
      monthlyIncomeCents: 500000,
      currentCheckingBalanceCents: 100000,
    });
    expect(impact).toBe(70); // 6 purchases * 70c = 420c total / 6 months = 70c/month
  });

  it("computes percent_of_deposit impact directly from monthly income", () => {
    const rule: RuleDsl = {
      trigger: { type: "deposit" },
      conditions: [],
      action: { type: "percent_of_deposit", percent: 10 },
      safety: { balanceFloorCents: 0, dailyCapCents: 50000 },
    };
    const impact = projectMonthlyImpactCents(rule, {
      purchases: [],
      historyMonths: 6,
      monthlyIncomeCents: 500000,
      currentCheckingBalanceCents: 100000,
    });
    expect(impact).toBe(50000);
  });
});
