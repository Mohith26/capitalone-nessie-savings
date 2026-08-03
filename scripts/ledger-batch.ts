/* eslint-disable no-console */
import fs from "node:fs";
import path from "node:path";
import { loadEnv } from "../src/env";
import { NessieClient } from "../src/nessie-client/client";
import { prisma } from "../src/db/prisma";
import { purchaseEventFromNessie, type PurchaseEvent } from "../src/engine/matching";
import { processPurchaseForRule, type ActiveRule } from "../src/engine/execute";
import type { RuleDsl } from "../src/dsl/schema";

loadEnv();

/**
 * Drives REAL seeded purchases for the first N customers through the actual execution
 * engine (real Postgres ledger + real Nessie mock transfers), then REPLAYS the exact
 * same batch to prove idempotency at volume. Produces the append-only ledger that
 * `npm run audit` then measures (100% attribution, 0 duplicates).
 *
 * Every matching purchase becomes one idempotent transfer keyed by
 * hash(ruleId, purchaseId); the replay pass must add ZERO new rows.
 *
 * The ledger is cleared at the start so the reported count is deterministic and
 * reproducible (this is a local dev DB; the append-only guarantee is a per-row
 * property proven by the idempotency tests, not a claim that we never truncate in dev).
 */
const BATCH_CUSTOMERS = Number(process.env.LEDGER_BATCH_CUSTOMERS ?? "50");
const HIGH_BALANCE_CENTS = 100_000_000; // keep the balance floor from blocking; this run measures ledger integrity, not savings

// Flat round-up to the nearest dollar with a generous daily cap so every matching
// purchase yields exactly one transfer (mirrors the sim's flat_roundup mix, minus the
// tight daily cap that would otherwise block some same-day round-ups).
const RULE_DSL: RuleDsl = {
  trigger: { type: "purchase" },
  conditions: [],
  action: { type: "round_up", toCents: 100 },
  safety: { balanceFloorCents: 0, dailyCapCents: 100_000 },
};

interface DirectoryEntry {
  customerId: string;
  checkingAccountId: string;
  savingsAccountId: string;
}

async function processAll(rule: ActiveRule, events: PurchaseEvent[]): Promise<{ transferred: number; duplicate: number; blocked: number }> {
  let transferred = 0;
  let duplicate = 0;
  let blocked = 0;
  for (const event of events) {
    const outcome = await processPurchaseForRule(prisma, nessie, rule, event, HIGH_BALANCE_CENTS);
    if (outcome.status === "transferred") transferred += 1;
    else if (outcome.status === "duplicate_skipped") duplicate += 1;
    else if (outcome.status === "blocked") blocked += 1;
  }
  return { transferred, duplicate, blocked };
}

const nessie = new NessieClient({
  baseUrl: process.env.NESSIE_BASE_URL ?? "http://localhost:4173",
  apiKey: process.env.NESSIE_API_KEY ?? "local-mock-key",
});

async function main() {
  console.log(`Clearing ledger + rules for a deterministic batch of ${BATCH_CUSTOMERS} customers...`);
  await prisma.transfer.deleteMany({});
  await prisma.rule.deleteMany({});

  const directory: DirectoryEntry[] = JSON.parse(fs.readFileSync(path.resolve("data/directory.json"), "utf8")).slice(
    0,
    BATCH_CUSTOMERS,
  );

  let pass1Transferred = 0;
  let pass1Blocked = 0;
  let pass2Transferred = 0;
  let pass2Duplicate = 0;

  for (const d of directory) {
    const ruleRow = await prisma.rule.create({
      data: {
        customerId: d.customerId,
        accountId: d.checkingAccountId,
        savingsAccountId: d.savingsAccountId,
        name: "Batch flat round-up",
        dsl: RULE_DSL as never,
      },
    });
    const rule: ActiveRule = {
      id: ruleRow.id,
      customerId: d.customerId,
      accountId: d.checkingAccountId,
      savingsAccountId: d.savingsAccountId,
      dsl: RULE_DSL,
    };

    const purchases = (await nessie.listPurchases(d.checkingAccountId)).map(purchaseEventFromNessie);

    const first = await processAll(rule, purchases);
    pass1Transferred += first.transferred;
    pass1Blocked += first.blocked;

    // Replay the identical batch: idempotency must make every one a no-op.
    const second = await processAll(rule, purchases);
    pass2Transferred += second.transferred;
    pass2Duplicate += second.duplicate;
  }

  const ledgerCount = await prisma.transfer.count();
  console.log(`\nPass 1 (initial):  ${pass1Transferred} transferred, ${pass1Blocked} blocked by safety rails`);
  console.log(`Pass 2 (replay):   ${pass2Transferred} newly transferred (must be 0), ${pass2Duplicate} duplicate-skipped`);
  console.log(`Ledger rows after both passes: ${ledgerCount}`);

  await prisma.$disconnect();

  if (pass2Transferred !== 0 || ledgerCount !== pass1Transferred) {
    console.error("BATCH FAILED: replay created duplicate ledger rows.");
    process.exit(1);
  }
  console.log(`\nBATCH PASSED: ${ledgerCount} idempotent transfers, replay added 0 duplicates. Run \`npm run audit\` next.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
