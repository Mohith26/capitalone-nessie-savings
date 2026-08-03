import { describe, expect, it } from "vitest";
import { validateRuleDsl } from "../src/dsl/schema";

const VALID_ROUNDUP = {
  trigger: { type: "purchase" },
  conditions: [{ type: "merchant_category", categories: ["coffee"] }],
  action: { type: "round_up", toCents: 100 },
  safety: { balanceFloorCents: 5000, dailyCapCents: 2000 },
};

describe("validateRuleDsl - happy path", () => {
  it("accepts a well-formed round-up rule", () => {
    const result = validateRuleDsl(VALID_ROUNDUP);
    expect(result.ok).toBe(true);
  });

  it("accepts a well-formed percent-of-deposit rule", () => {
    const result = validateRuleDsl({
      trigger: { type: "deposit" },
      conditions: [],
      action: { type: "percent_of_deposit", percent: 10 },
      safety: { balanceFloorCents: 0, dailyCapCents: 100000 },
    });
    expect(result.ok).toBe(true);
  });
});

describe("validateRuleDsl - adversarial cases (must all be rejected)", () => {
  it("rejects negative fixed_transfer amounts", () => {
    const result = validateRuleDsl({
      trigger: { type: "purchase" },
      conditions: [],
      action: { type: "fixed_transfer", amountCents: -500 },
      safety: { balanceFloorCents: 0, dailyCapCents: 1000 },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects zero-amount fixed_transfer", () => {
    const result = validateRuleDsl({
      trigger: { type: "purchase" },
      conditions: [],
      action: { type: "fixed_transfer", amountCents: 0 },
      safety: { balanceFloorCents: 0, dailyCapCents: 1000 },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a negative balance floor", () => {
    const result = validateRuleDsl({
      trigger: { type: "purchase" },
      conditions: [],
      action: { type: "round_up", toCents: 100 },
      safety: { balanceFloorCents: -100, dailyCapCents: 1000 },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a non-positive daily cap", () => {
    const result = validateRuleDsl({
      trigger: { type: "purchase" },
      conditions: [],
      action: { type: "round_up", toCents: 100 },
      safety: { balanceFloorCents: 0, dailyCapCents: 0 },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects fixed_transfer amount exceeding its own daily cap", () => {
    const result = validateRuleDsl({
      trigger: { type: "purchase" },
      conditions: [],
      action: { type: "fixed_transfer", amountCents: 5000 },
      safety: { balanceFloorCents: 0, dailyCapCents: 1000 },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects percent_of_deposit paired with a purchase trigger", () => {
    const result = validateRuleDsl({
      trigger: { type: "purchase" },
      conditions: [],
      action: { type: "percent_of_deposit", percent: 20 },
      safety: { balanceFloorCents: 0, dailyCapCents: 100000 },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects round_up paired with a deposit trigger", () => {
    const result = validateRuleDsl({
      trigger: { type: "deposit" },
      conditions: [],
      action: { type: "round_up", toCents: 100 },
      safety: { balanceFloorCents: 0, dailyCapCents: 100000 },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects percent_of_deposit over 100%", () => {
    const result = validateRuleDsl({
      trigger: { type: "deposit" },
      conditions: [],
      action: { type: "percent_of_deposit", percent: 150 },
      safety: { balanceFloorCents: 0, dailyCapCents: 100000 },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects an amount_range condition with min > max", () => {
    const result = validateRuleDsl({
      trigger: { type: "purchase" },
      conditions: [{ type: "amount_range", minCents: 5000, maxCents: 1000 }],
      action: { type: "round_up", toCents: 100 },
      safety: { balanceFloorCents: 0, dailyCapCents: 100000 },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects an unknown action type", () => {
    const result = validateRuleDsl({
      trigger: { type: "purchase" },
      conditions: [],
      action: { type: "transfer_everything", amountCents: 100 },
      safety: { balanceFloorCents: 0, dailyCapCents: 1000 },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a rule missing the safety block entirely", () => {
    const result = validateRuleDsl({
      trigger: { type: "purchase" },
      conditions: [],
      action: { type: "round_up", toCents: 100 },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a non-object payload", () => {
    const result = validateRuleDsl("save $5 every coffee");
    expect(result.ok).toBe(false);
  });

  it("rejects an invalid round_up denomination (not in the allowed set)", () => {
    const result = validateRuleDsl({
      trigger: { type: "purchase" },
      conditions: [],
      action: { type: "round_up", toCents: 137 },
      safety: { balanceFloorCents: 0, dailyCapCents: 1000 },
    });
    expect(result.ok).toBe(false);
  });
});
