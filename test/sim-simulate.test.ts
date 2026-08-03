import { describe, expect, it } from "vitest";
import { simulateCustomer } from "../src/sim/simulate";
import type { PurchaseEvent } from "../src/engine/matching";
import type { RuleDsl } from "../src/dsl/schema";

const roundUpRule: RuleDsl = {
  trigger: { type: "purchase" },
  conditions: [],
  action: { type: "round_up", toCents: 100 },
  safety: { balanceFloorCents: 0, dailyCapCents: 100000 },
};

describe("simulateCustomer", () => {
  it("accumulates round-up savings across purchases with no safety constraints hit", () => {
    const purchases: PurchaseEvent[] = [
      { transactionId: "1", accountId: "a", merchantCategory: "coffee", amountCents: 430, date: "2026-01-05" }, // +70
      { transactionId: "2", accountId: "a", merchantCategory: "groceries", amountCents: 2510, date: "2026-01-06" }, // +90
    ];
    const result = simulateCustomer(purchases, 500000, 1, 100000, 0, [roundUpRule]);
    expect(result.transfersExecuted).toBe(2);
    expect(result.transfersBlocked).toBe(0);
    expect(result.totalSavedCents).toBe(160);
    expect(result.endingSavingsCents).toBe(160);
  });

  it("blocks transfers once the checking balance would breach the floor", () => {
    const tightFloorRule: RuleDsl = {
      ...roundUpRule,
      action: { type: "round_up", toCents: 1000 }, // large round-ups to force floor breach
      safety: { balanceFloorCents: 400, dailyCapCents: 100000 },
    };
    const purchases: PurchaseEvent[] = [
      { transactionId: "1", accountId: "a", merchantCategory: "coffee", amountCents: 10, date: "2026-01-05" }, // roundup=990, checking starts 1000
    ];
    // starting checking of 1000, no income this period: after purchase, checking=990;
    // proposed transfer 990 would leave 0 < floor 400 -> blocked
    const result = simulateCustomer(purchases, 0, 1, 1000, 0, [tightFloorRule]);
    expect(result.transfersExecuted).toBe(0);
    expect(result.transfersBlocked).toBe(1);
    expect(result.totalSavedCents).toBe(0);
  });

  it("respects the daily cap across multiple same-day purchases", () => {
    const cappedRule: RuleDsl = {
      trigger: { type: "purchase" },
      conditions: [],
      action: { type: "fixed_transfer", amountCents: 400 },
      safety: { balanceFloorCents: 0, dailyCapCents: 500 },
    };
    const purchases: PurchaseEvent[] = [
      { transactionId: "1", accountId: "a", merchantCategory: "gas", amountCents: 1000, date: "2026-01-05" },
      { transactionId: "2", accountId: "a", merchantCategory: "gas", amountCents: 1000, date: "2026-01-05" },
    ];
    const result = simulateCustomer(purchases, 500000, 1, 100000, 0, [cappedRule]);
    expect(result.transfersExecuted).toBe(1); // first 400 allowed, second would be 800 > 500 cap
    expect(result.transfersBlocked).toBe(1);
    expect(result.totalSavedCents).toBe(400);
  });

  it("applies percent_of_deposit against synthesized monthly income deposits", () => {
    const percentRule: RuleDsl = {
      trigger: { type: "deposit" },
      conditions: [],
      action: { type: "percent_of_deposit", percent: 10 },
      safety: { balanceFloorCents: 0, dailyCapCents: 1000000 },
    };
    const purchases: PurchaseEvent[] = [
      { transactionId: "1", accountId: "a", merchantCategory: "coffee", amountCents: 400, date: "2026-01-05" },
    ];
    const result = simulateCustomer(purchases, 500000, 3, 100000, 0, [percentRule]);
    // 3 monthly deposits of $5000 each at 10% = $500 each = 1500 total
    expect(result.transfersExecuted).toBe(3);
    expect(result.totalSavedCents).toBe(150000);
  });
});
