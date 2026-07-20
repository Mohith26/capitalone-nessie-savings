/* eslint-disable no-console */
import fs from "node:fs";
import path from "node:path";
import { faker } from "@faker-js/faker";
import { loadEnv } from "../src/env.js";
import { NessieClient } from "../src/nessie-client/client.js";
import { buildPersonaProfile, personaKindForIndex } from "../src/personas/personas.js";
import { generatePurchaseHistory } from "../src/personas/history.js";

loadEnv();

const CUSTOMER_COUNT = Number(process.env.SEED_CUSTOMER_COUNT ?? "500");
const NESSIE_BASE_URL = process.env.NESSIE_BASE_URL ?? "http://localhost:4173";
const NESSIE_API_KEY = process.env.NESSIE_API_KEY ?? "local-mock-key";
const CONCURRENCY = 25;

interface DirectoryEntry {
  customerId: string;
  firstName: string;
  lastName: string;
  personaKind: string;
  checkingAccountId: string;
  savingsAccountId: string;
  monthlyIncomeCents: number;
  purchaseCount: number;
  firstPurchaseDate: string | null;
  lastPurchaseDate: string | null;
}

async function seedOneCustomer(client: NessieClient, index: number): Promise<DirectoryEntry> {
  const personaKind = personaKindForIndex(index);
  const profile = buildPersonaProfile(personaKind);
  const firstName = faker.person.firstName();
  const lastName = faker.person.lastName();

  const customer = await client.createCustomer({
    first_name: firstName,
    last_name: lastName,
    address: {
      street_number: faker.location.buildingNumber(),
      street_name: faker.location.street(),
      city: faker.location.city(),
      state: faker.location.state({ abbreviated: true }),
      zip: faker.location.zipCode("#####"),
    },
  });

  const checking = await client.createAccount(customer._id, {
    type: "Checking",
    nickname: "Everyday Checking",
    rewards: 0,
    balance: profile.startingCheckingCents,
  });
  const savings = await client.createAccount(customer._id, {
    type: "Savings",
    nickname: "Savings Goal",
    rewards: 0,
    balance: profile.startingSavingsCents,
  });

  const purchases = generatePurchaseHistory(profile, 6);
  if (purchases.length > 0) {
    await client.createPurchasesBulk(checking._id, purchases);
  }

  return {
    customerId: customer._id,
    firstName,
    lastName,
    personaKind,
    checkingAccountId: checking._id,
    savingsAccountId: savings._id,
    monthlyIncomeCents: profile.monthlyIncomeCents,
    purchaseCount: purchases.length,
    firstPurchaseDate: purchases[0]?.purchase_date ?? null,
    lastPurchaseDate: purchases[purchases.length - 1]?.purchase_date ?? null,
  };
}

async function runPool<T>(items: number[], limit: number, worker: (i: number) => Promise<T>): Promise<T[]> {
  const results: T[] = new Array(items.length);
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
  console.log(`Seeding ${CUSTOMER_COUNT} customers against ${NESSIE_BASE_URL} ...`);
  const client = new NessieClient({ baseUrl: NESSIE_BASE_URL, apiKey: NESSIE_API_KEY });
  const startedAt = Date.now();

  const indices = Array.from({ length: CUSTOMER_COUNT }, (_, i) => i);
  const directory = await runPool(indices, CONCURRENCY, (i) => seedOneCustomer(client, i));

  const elapsedMs = Date.now() - startedAt;
  const outDir = path.resolve("data");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "directory.json"), JSON.stringify(directory, null, 2));

  console.log(`Seeded ${directory.length} customers in ${elapsedMs}ms`);
  console.log(`Directory written to data/directory.json`);

  // Spot-check: print a few random personas so a human can sanity-check the data.
  const sampleIdx = faker.helpers.arrayElements(
    Array.from({ length: directory.length }, (_, i) => i),
    5,
  );
  console.log("\nSpot-check sample:");
  for (const i of sampleIdx) {
    const d = directory[i];
    console.log(
      `  ${d.firstName} ${d.lastName} [${d.personaKind}] income=$${(d.monthlyIncomeCents / 100).toFixed(2)}/mo ` +
        `purchases=${d.purchaseCount} range=${d.firstPurchaseDate}..${d.lastPurchaseDate}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
