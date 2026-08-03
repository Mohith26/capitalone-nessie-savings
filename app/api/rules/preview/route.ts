import { NextResponse } from "next/server";
import { findDirectoryEntry } from "@/src/db/directory";
import { nessieClientFromEnv } from "@/src/nessie-client/client";
import { purchaseEventFromNessie } from "@/src/engine/matching";
import { compilePlainEnglishRule } from "@/src/compiler/compile";

/** POST { customerId, text } -> plain-English rule preview (never activates). */
export async function POST(request: Request) {
  const body = (await request.json()) as { customerId?: string; text?: string };
  if (!body.customerId || !body.text) {
    return NextResponse.json({ error: "customerId and text are required" }, { status: 400 });
  }

  const entry = findDirectoryEntry(body.customerId);
  if (!entry) return NextResponse.json({ error: "customer not found" }, { status: 404 });

  const nessie = nessieClientFromEnv();
  const [nessiePurchases, checking] = await Promise.all([
    nessie.listPurchases(entry.checkingAccountId),
    nessie.getAccount(entry.checkingAccountId),
  ]);

  const outcome = await compilePlainEnglishRule(body.text, {
    purchases: nessiePurchases.map(purchaseEventFromNessie),
    historyMonths: 6,
    monthlyIncomeCents: entry.monthlyIncomeCents,
    currentCheckingBalanceCents: checking.balance,
  });

  return NextResponse.json(outcome);
}
