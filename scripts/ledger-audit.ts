/* eslint-disable no-console */
import { loadEnv } from "../src/env";
import { prisma } from "../src/db/prisma";

loadEnv();

/**
 * Reproducible ledger audit for the spec's "Metrics to capture":
 *   - every transfer traceable to a rule + triggering transaction (target 100%)
 *   - duplicate transfers (target 0)
 * Reads the real append-only Postgres ledger (populated by the engine via
 * `npm run demo` / the idempotency tests) and reports the numbers directly.
 */
async function main() {
  const total = await prisma.transfer.count();

  const attributed = await prisma.transfer.count({
    where: {
      AND: [
        { ruleId: { not: "" } },
        { triggeringTransactionId: { not: "" } },
      ],
    },
  });

  // Every transfer must point at a rule row that actually exists (referential
  // integrity of the attribution, not just a non-empty string).
  const rows = await prisma.transfer.findMany({
    select: { id: true, ruleId: true, triggeringTransactionId: true, idempotencyKey: true },
  });
  const ruleIds = new Set(rows.map((r) => r.ruleId));
  const existingRules = await prisma.rule.findMany({
    where: { id: { in: [...ruleIds] } },
    select: { id: true },
  });
  const existingRuleIdSet = new Set(existingRules.map((r) => r.id));
  const fullyTraceable = rows.filter(
    (r) => r.ruleId && r.triggeringTransactionId && existingRuleIdSet.has(r.ruleId),
  ).length;

  const distinctKeys = new Set(rows.map((r) => r.idempotencyKey)).size;
  const duplicateTransfers = total - distinctKeys;

  const attributedPct = total === 0 ? 0 : (100 * attributed) / total;
  const traceablePct = total === 0 ? 0 : (100 * fullyTraceable) / total;

  console.log("Ledger audit (real Postgres ledger):");
  console.log(`  total transfers:                 ${total}`);
  console.log(`  with rule + triggering txn id:   ${attributed} (${attributedPct.toFixed(1)}%)`);
  console.log(`  fully traceable (rule row exists): ${fullyTraceable} (${traceablePct.toFixed(1)}%)`);
  console.log(`  distinct idempotency keys:       ${distinctKeys}`);
  console.log(`  duplicate transfers:             ${duplicateTransfers}`);

  await prisma.$disconnect();

  if (total > 0 && (attributed !== total || fullyTraceable !== total || duplicateTransfers !== 0)) {
    console.error("LEDGER AUDIT FAILED: not every transfer is uniquely attributed.");
    process.exit(1);
  }
  console.log("\nLEDGER AUDIT PASSED: 100% attributed, 0 duplicates.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
