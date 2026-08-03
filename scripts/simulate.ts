/* eslint-disable no-console */
import fs from "node:fs";
import path from "node:path";
import { loadEnv } from "../src/env";
import { NessieClient } from "../src/nessie-client/client";
import { purchaseEventFromNessie } from "../src/engine/matching";
import { simulateCustomer } from "../src/sim/simulate";
import { ruleMixForIndex } from "../src/sim/rule-mixes";

loadEnv();

interface DirectoryEntry {
  customerId: string;
  personaKind: string;
  checkingAccountId: string;
  monthlyIncomeCents: number;
}

const HISTORY_MONTHS = 6;
const CONCURRENCY = 25;

async function runPool<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function next(): Promise<void> {
    const current = cursor;
    cursor += 1;
    if (current >= items.length) return;
    results[current] = await worker(items[current]);
    await next();
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => next()));
  return results;
}

async function main() {
  const nessie = new NessieClient({
    baseUrl: process.env.NESSIE_BASE_URL ?? "http://localhost:4173",
    apiKey: process.env.NESSIE_API_KEY ?? "local-mock-key",
  });

  const directory: DirectoryEntry[] = JSON.parse(fs.readFileSync(path.resolve("data/directory.json"), "utf8"));
  console.log(`Simulating ${directory.length} customers across ${HISTORY_MONTHS} months of seeded history...`);

  const perCustomer = await runPool(
    directory.map((d, i) => ({ d, i })),
    CONCURRENCY,
    async ({ d, i }) => {
      const nessiePurchases = await nessie.listPurchases(d.checkingAccountId);
      const purchases = nessiePurchases.map(purchaseEventFromNessie);
      const mix = ruleMixForIndex(i);
      const account = await nessie.getAccount(d.checkingAccountId);
      // reconstruct the STARTING checking balance (mock's stored balance already has
      // all 6 months of purchases subtracted, since we bulk-seeded them up front)
      const totalSpent = purchases.reduce((sum, p) => sum + p.amountCents, 0);
      const startingChecking = account.balance + totalSpent;

      const result = simulateCustomer(purchases, d.monthlyIncomeCents, HISTORY_MONTHS, startingChecking, 0, mix.rules);
      return {
        customerId: d.customerId,
        personaKind: d.personaKind,
        ruleMixName: mix.name,
        totalSavedCents: result.totalSavedCents,
        monthlyAvgSavedCents: result.totalSavedCents / HISTORY_MONTHS,
        transfersExecuted: result.transfersExecuted,
        transfersBlocked: result.transfersBlocked,
      };
    },
  );

  fs.writeFileSync(path.resolve("data/simulation-per-customer.json"), JSON.stringify(perCustomer, null, 2));

  // Aggregate: median/p25/p75 monthly savings per (persona, ruleMix) group.
  const groups = new Map<string, number[]>();
  const groupMeta = new Map<string, { personaKind: string; ruleMixName: string }>();
  for (const r of perCustomer) {
    const key = `${r.personaKind}::${r.ruleMixName}`;
    if (!groups.has(key)) {
      groups.set(key, []);
      groupMeta.set(key, { personaKind: r.personaKind, ruleMixName: r.ruleMixName });
    }
    groups.get(key)!.push(r.monthlyAvgSavedCents);
  }

  function quantile(sorted: number[], q: number): number {
    const pos = (sorted.length - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    if (sorted[base + 1] !== undefined) {
      return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
    }
    return sorted[base];
  }

  const aggregated = [...groups.entries()].map(([key, values]) => {
    const sorted = [...values].sort((a, b) => a - b);
    const meta = groupMeta.get(key)!;
    return {
      ...meta,
      customerCount: sorted.length,
      medianMonthlySavedCents: quantile(sorted, 0.5),
      p25MonthlySavedCents: quantile(sorted, 0.25),
      p75MonthlySavedCents: quantile(sorted, 0.75),
    };
  });

  // Also aggregate by rule mix alone (ignoring persona) for the headline "which
  // mix outperforms flat round-ups" comparison.
  const byMix = new Map<string, number[]>();
  for (const r of perCustomer) {
    if (!byMix.has(r.ruleMixName)) byMix.set(r.ruleMixName, []);
    byMix.get(r.ruleMixName)!.push(r.monthlyAvgSavedCents);
  }
  const mixSummary = [...byMix.entries()].map(([ruleMixName, values]) => {
    const sorted = [...values].sort((a, b) => a - b);
    return {
      ruleMixName,
      customerCount: sorted.length,
      medianMonthlySavedCents: quantile(sorted, 0.5),
      p25MonthlySavedCents: quantile(sorted, 0.25),
      p75MonthlySavedCents: quantile(sorted, 0.75),
    };
  });

  const overallSorted = perCustomer.map((r) => r.monthlyAvgSavedCents).sort((a, b) => a - b);
  const overall = {
    customerCount: overallSorted.length,
    medianMonthlySavedCents: quantile(overallSorted, 0.5),
    p25MonthlySavedCents: quantile(overallSorted, 0.25),
    p75MonthlySavedCents: quantile(overallSorted, 0.75),
    totalTransfersExecuted: perCustomer.reduce((s, r) => s + r.transfersExecuted, 0),
    totalTransfersBlocked: perCustomer.reduce((s, r) => s + r.transfersBlocked, 0),
  };

  const report = { ranAt: new Date().toISOString(), overall, byRuleMix: mixSummary, byPersonaAndMix: aggregated };
  fs.writeFileSync(path.resolve("data/simulation-results.json"), JSON.stringify(report, null, 2));

  console.log("\nOverall (all 500 customers, all mixes):");
  console.log(
    `  median $${(overall.medianMonthlySavedCents / 100).toFixed(2)}/mo` +
      ` (p25 $${(overall.p25MonthlySavedCents / 100).toFixed(2)}, p75 $${(overall.p75MonthlySavedCents / 100).toFixed(2)})`,
  );
  console.log(`  transfers executed: ${overall.totalTransfersExecuted}, blocked by safety rails: ${overall.totalTransfersBlocked}`);

  console.log("\nBy rule mix:");
  for (const m of mixSummary) {
    console.log(
      `  ${m.ruleMixName.padEnd(28)} n=${m.customerCount.toString().padEnd(4)} median $${(m.medianMonthlySavedCents / 100).toFixed(2)}/mo`,
    );
  }
  console.log(`\nFull report written to data/simulation-results.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
