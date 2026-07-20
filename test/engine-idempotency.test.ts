import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadEnv } from "../src/env.js";
import { prisma } from "../src/db/prisma.js";
import { NessieClient } from "../src/nessie-client/client.js";
import { processPurchaseForRule, type ActiveRule } from "../src/engine/execute.js";
import type { PurchaseEvent } from "../src/engine/matching.js";
import type { RuleDsl } from "../src/dsl/schema.js";

loadEnv();

const nessie = new NessieClient({
  baseUrl: process.env.NESSIE_BASE_URL ?? "http://localhost:4173",
  apiKey: process.env.NESSIE_API_KEY ?? "local-mock-key",
});

/**
 * These are integration tests: they require the local Nessie mock server AND the
 * local Postgres instance to be running (see README "reproduce the metrics").
 */
describe("engine idempotency (integration)", () => {
  let checkingId: string;
  let savingsId: string;
  let customerId: string;

  beforeAll(async () => {
    const customer = await nessie.createCustomer({
      first_name: "Idempotency",
      last_name: "Test",
      address: { street_number: "1", street_name: "Test St", city: "Austin", state: "TX", zip: "78701" },
    });
    customerId = customer._id;
    const checking = await nessie.createAccount(customerId, {
      type: "Checking",
      nickname: "test-checking",
      rewards: 0,
      balance: 100000,
    });
    const savings = await nessie.createAccount(customerId, {
      type: "Savings",
      nickname: "test-savings",
      rewards: 0,
      balance: 0,
    });
    checkingId = checking._id;
    savingsId = savings._id;
  });

  afterAll(async () => {
    await prisma.transfer.deleteMany({ where: { customerId } });
    await prisma.rule.deleteMany({ where: { customerId } });
  });

  async function makeRule(dsl: RuleDsl): Promise<ActiveRule> {
    const row = await prisma.rule.create({
      data: {
        customerId,
        accountId: checkingId,
        savingsAccountId: savingsId,
        name: "test rule",
        dsl: dsl as never,
      },
    });
    return { id: row.id, customerId, accountId: checkingId, savingsAccountId: savingsId, dsl };
  }

  it("replaying the same purchase through the engine produces zero duplicate transfers", async () => {
    const rule = await makeRule({
      trigger: { type: "purchase" },
      conditions: [{ type: "merchant_category", categories: ["coffee"] }],
      action: { type: "fixed_transfer", amountCents: 200 },
      safety: { balanceFloorCents: 0, dailyCapCents: 100000 },
    });

    const event: PurchaseEvent = {
      transactionId: `purch_${randomUUID()}`,
      accountId: checkingId,
      merchantCategory: "coffee",
      amountCents: 450,
      date: "2026-02-01",
    };

    const first = await processPurchaseForRule(prisma, nessie, rule, event, 100000);
    const second = await processPurchaseForRule(prisma, nessie, rule, event, 100000);
    const third = await processPurchaseForRule(prisma, nessie, rule, event, 100000);

    expect(first.status).toBe("transferred");
    expect(second.status).toBe("duplicate_skipped");
    expect(third.status).toBe("duplicate_skipped");

    const ledgerCount = await prisma.transfer.count({ where: { ruleId: rule.id } });
    expect(ledgerCount).toBe(1);

    const savingsAccount = await nessie.getAccount(savingsId);
    expect(savingsAccount.balance).toBe(200); // moved exactly once, not 3 times
  });

  it("blocks a transfer that would breach the balance floor", async () => {
    const rule = await makeRule({
      trigger: { type: "purchase" },
      conditions: [],
      action: { type: "fixed_transfer", amountCents: 5000 },
      safety: { balanceFloorCents: 99000, dailyCapCents: 100000 },
    });
    const event: PurchaseEvent = {
      transactionId: `purch_${randomUUID()}`,
      accountId: checkingId,
      merchantCategory: "groceries",
      amountCents: 3000,
      date: "2026-02-02",
    };

    const outcome = await processPurchaseForRule(prisma, nessie, rule, event, 100000);
    expect(outcome).toEqual({ status: "blocked", reason: "balance_floor_violation" });

    const ledgerCount = await prisma.transfer.count({ where: { ruleId: rule.id } });
    expect(ledgerCount).toBe(0);
  });

  it("blocks additional transfers once the rule's daily cap is reached", async () => {
    const rule = await makeRule({
      trigger: { type: "purchase" },
      conditions: [],
      action: { type: "fixed_transfer", amountCents: 400 },
      safety: { balanceFloorCents: 0, dailyCapCents: 500 },
    });

    const day = "2026-02-03";
    const first = await processPurchaseForRule(
      prisma,
      nessie,
      rule,
      { transactionId: `purch_${randomUUID()}`, accountId: checkingId, merchantCategory: "gas", amountCents: 1000, date: day },
      100000,
    );
    const second = await processPurchaseForRule(
      prisma,
      nessie,
      rule,
      { transactionId: `purch_${randomUUID()}`, accountId: checkingId, merchantCategory: "gas", amountCents: 1000, date: day },
      100000,
    );

    expect(first.status).toBe("transferred"); // 400 <= 500 cap
    expect(second).toEqual({ status: "blocked", reason: "daily_cap_exceeded" }); // 400+400 > 500 cap

    const ledgerCount = await prisma.transfer.count({ where: { ruleId: rule.id } });
    expect(ledgerCount).toBe(1);
  });
});
