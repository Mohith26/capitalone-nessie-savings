/* eslint-disable no-console */
import fs from "node:fs";
import path from "node:path";
import { loadEnv } from "../src/env.js";
import { compilePlainEnglishRule } from "../src/compiler/compile.js";
import { matchesExpectedShape, type ExpectedShape } from "../src/compiler/eval-compare.js";
import type { ImpactHistoryContext } from "../src/compiler/impact.js";

loadEnv();

interface PhrasingFixture {
  text: string;
  expected: ExpectedShape;
}
interface UnsafeFixture {
  text: string;
  reason_category: string;
}

const dummyHistory: ImpactHistoryContext = {
  purchases: [],
  historyMonths: 6,
  monthlyIncomeCents: 500000,
  currentCheckingBalanceCents: 150000,
};

async function main() {
  const phrasings: PhrasingFixture[] = JSON.parse(fs.readFileSync(path.resolve("eval/phrasings.json"), "utf8"));
  const unsafe: UnsafeFixture[] = JSON.parse(fs.readFileSync(path.resolve("eval/unsafe-requests.json"), "utf8"));

  console.log(`Running compiler eval: ${phrasings.length} phrasings + ${unsafe.length} unsafe requests...`);

  const phrasingResults = [] as Array<{ text: string; match: boolean; status: string; actual?: unknown }>;
  for (const fixture of phrasings) {
    const outcome = await compilePlainEnglishRule(fixture.text, dummyHistory);
    let match = false;
    let actual: unknown;
    if (outcome.status === "preview") {
      actual = { trigger: outcome.dsl.trigger, conditions: outcome.dsl.conditions, action: outcome.dsl.action };
      match = matchesExpectedShape(actual as ExpectedShape, fixture.expected);
    }
    phrasingResults.push({ text: fixture.text, match, status: outcome.status, actual });
    console.log(`  [${match ? "MATCH" : "MISS "}] (${outcome.status}) "${fixture.text}"`);
  }

  const unsafeResults = [] as Array<{ text: string; correctlyRejected: boolean }>;
  for (const fixture of unsafe) {
    const outcome = await compilePlainEnglishRule(fixture.text, dummyHistory);
    const correctlyRejected = outcome.status === "rejected";
    unsafeResults.push({ text: fixture.text, correctlyRejected });
    console.log(`  [${correctlyRejected ? "REJECTED (correct)" : "NOT REJECTED (WRONG)"}] "${fixture.text}"`);
  }

  const exactMatchCount = phrasingResults.filter((r) => r.match).length;
  const exactMatchPct = (100 * exactMatchCount) / phrasings.length;
  const rejectionCorrect = unsafeResults.filter((r) => r.correctlyRejected).length;
  const rejectionPct = (100 * rejectionCorrect) / unsafe.length;

  const report = {
    ranAt: new Date().toISOString(),
    model: process.env.OLLAMA_MODEL ?? "llama3.1:8b",
    phrasingCount: phrasings.length,
    exactMatchCount,
    exactMatchPct,
    unsafeCount: unsafe.length,
    rejectionCorrect,
    rejectionPct,
    phrasingResults,
    unsafeResults,
  };
  fs.writeFileSync(path.resolve("eval/results.json"), JSON.stringify(report, null, 2));

  console.log(`\nExact-match: ${exactMatchCount}/${phrasings.length} = ${exactMatchPct.toFixed(1)}%`);
  console.log(`Unsafe-rejection accuracy: ${rejectionCorrect}/${unsafe.length} = ${rejectionPct.toFixed(1)}%`);
  console.log(`Full report written to eval/results.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
