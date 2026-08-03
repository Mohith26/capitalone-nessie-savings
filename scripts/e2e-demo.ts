/* eslint-disable no-console */
import { loadEnv } from "../src/env";
import { NessieClient } from "../src/nessie-client/client";
import { prisma } from "../src/db/prisma";
import { compilePlainEnglishRule } from "../src/compiler/compile";
import { purchaseEventFromNessie } from "../src/engine/matching";
import { processPurchaseForRule, type ActiveRule } from "../src/engine/execute";

loadEnv();

/**
 * Phase 4 verify: "end-to-end demo: english rule -> preview -> activation -> transfer
 * on next purchase produces exactly one attributed transfer." Runs against the real
 * local Nessie mock + Postgres + Ollama -- no mocking, no shortcuts.
 */
async function main() {
  const nessie = new NessieClient({
    baseUrl: process.env.NESSIE_BASE_URL ?? "http://localhost:4173",
    apiKey: process.env.NESSIE_API_KEY ?? "local-mock-key",
  });

  console.log("1) Creating a fresh demo customer + checking/savings accounts...");
  const customer = await nessie.createCustomer({
    first_name: "Demo",
    last_name: "Customer",
    address: { street_number: "1", street_name: "Congress Ave", city: "Austin", state: "TX", zip: "78701" },
  });
  const checking = await nessie.createAccount(customer._id, {
    type: "Checking",
    nickname: "Demo Checking",
    rewards: 0,
    balance: 100000,
  });
  const savings = await nessie.createAccount(customer._id, {
    type: "Savings",
    nickname: "Demo Savings",
    rewards: 0,
    balance: 0,
  });
  console.log(`   customer=${customer._id} checking=${checking._id} savings=${savings._id}`);

  const englishText = "save $5 every time I order coffee";
  console.log(`\n2) Compiling plain-English rule: "${englishText}"`);
  const outcome = await compilePlainEnglishRule(englishText, {
    purchases: [],
    historyMonths: 6,
    monthlyIncomeCents: 500000,
    currentCheckingBalanceCents: checking.balance,
  });
  if (outcome.status !== "preview") {
    throw new Error(`expected a preview, got rejected: ${JSON.stringify(outcome)}`);
  }
  console.log(`   PREVIEW: ${outcome.explanation}`);
  console.log(`   projected monthly impact: $${(outcome.projectedMonthlyImpactCents / 100).toFixed(2)}`);
  console.log(`   dsl: ${JSON.stringify(outcome.dsl)}`);

  console.log("\n3) Activating the previewed rule (persisting to Postgres)...");
  const ruleRow = await prisma.rule.create({
    data: {
      customerId: customer._id,
      accountId: checking._id,
      savingsAccountId: savings._id,
      name: "Coffee round-up demo",
      sourceText: englishText,
      dsl: outcome.dsl as never,
    },
  });
  console.log(`   rule activated: ${ruleRow.id}`);

  console.log("\n4) Simulating the next matching purchase (a $4.30 coffee)...");
  const purchase = await nessie.createPurchase(checking._id, {
    merchant_id: "mer_coffee_demo",
    merchant_name: "Demo Coffee Co",
    merchant_category: "coffee",
    purchase_date: new Date().toISOString().slice(0, 10),
    amount: 430,
  });
  console.log(`   purchase created: ${purchase._id} for $${(purchase.amount / 100).toFixed(2)}`);

  const activeRule: ActiveRule = {
    id: ruleRow.id,
    customerId: customer._id,
    accountId: checking._id,
    savingsAccountId: savings._id,
    dsl: outcome.dsl,
  };
  const checkingNow = await nessie.getAccount(checking._id);
  const event = purchaseEventFromNessie(purchase);
  const execution = await processPurchaseForRule(prisma, nessie, activeRule, event, checkingNow.balance);
  console.log(`   engine outcome: ${JSON.stringify(execution)}`);

  if (execution.status !== "transferred") {
    throw new Error(`expected the engine to execute a transfer, got: ${JSON.stringify(execution)}`);
  }

  console.log("\n5) Verifying exactly one attributed transfer exists in the ledger...");
  const transfers = await prisma.transfer.findMany({ where: { customerId: customer._id } });
  if (transfers.length !== 1) {
    throw new Error(`expected exactly 1 ledger row, found ${transfers.length}`);
  }
  if (transfers[0].ruleId !== ruleRow.id || transfers[0].triggeringTransactionId !== purchase._id) {
    throw new Error("ledger row is not correctly attributed to the rule + triggering transaction");
  }
  const savingsNow = await nessie.getAccount(savings._id);
  console.log(`   ledger rows for this customer: ${transfers.length}`);
  console.log(`   transfer amount: $${(transfers[0].amountCents / 100).toFixed(2)}`);
  console.log(`   savings balance now: $${(savingsNow.balance / 100).toFixed(2)}`);
  console.log(
    `   attribution: transfer ${transfers[0].id} -> rule ${transfers[0].ruleId} -> transaction ${transfers[0].triggeringTransactionId}`,
  );

  console.log("\nE2E DEMO PASSED: english rule -> preview -> activation -> exactly one attributed transfer.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("E2E DEMO FAILED:", err);
    process.exit(1);
  });
