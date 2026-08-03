import fs from "node:fs";
import path from "node:path";

export interface DirectoryEntry {
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

let cache: DirectoryEntry[] | null = null;

/** The 500-customer seed directory (see scripts/seed.ts). Cached in-process. */
export function loadDirectory(): DirectoryEntry[] {
  if (cache) return cache;
  const filePath = path.resolve("data/directory.json");
  if (!fs.existsSync(filePath)) return [];
  cache = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return cache!;
}

export function findDirectoryEntry(customerId: string): DirectoryEntry | undefined {
  return loadDirectory().find((d) => d.customerId === customerId);
}
