import { NextResponse } from "next/server";
import { validateRuleDsl } from "@/src/dsl/schema";
import { defaultDailyCapCentsForAction, DEFAULT_BALANCE_FLOOR_CENTS } from "@/src/compiler/defaults";
import { projectMonthlyImpactCents } from "@/src/compiler/impact";
import { findDirectoryEntry } from "@/src/db/directory";
import { nessieClientFromEnv } from "@/src/nessie-client/client";
import { purchaseEventFromNessie } from "@/src/engine/matching";

/**
 * Deterministic "add via form" path: the client already assembled a trigger +
 * conditions + action (no LLM involved). We still apply the same code-owned safety
 * defaults, zod validation, and history-based impact projection as the plain-English
 * path, then return a preview -- form-created rules get the exact same
 * preview-before-activation guarantee as LLM-created ones.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as {
    customerId?: string;
    trigger?: unknown;
    conditions?: unknown;
    action?: unknown;
  };
  if (!body.customerId || !body.trigger || !body.action) {
    return NextResponse.json({ error: "customerId, trigger, and action are required" }, { status: 400 });
  }

  const entry = findDirectoryEntry(body.customerId);
  if (!entry) return NextResponse.json({ error: "customer not found" }, { status: 404 });

  const candidate = {
    trigger: body.trigger,
    conditions: body.conditions ?? [],
    action: body.action,
    safety: {
      balanceFloorCents: DEFAULT_BALANCE_FLOOR_CENTS,
      dailyCapCents: defaultDailyCapCentsForAction(body.action as never),
    },
  };
  const validated = validateRuleDsl(candidate);
  if (!validated.ok) {
    return NextResponse.json({ status: "rejected", reason: validated.errors?.join("; ") ?? "invalid rule" });
  }

  const nessie = nessieClientFromEnv();
  const [nessiePurchases, checking] = await Promise.all([
    nessie.listPurchases(entry.checkingAccountId),
    nessie.getAccount(entry.checkingAccountId),
  ]);
  const projectedMonthlyImpactCents = projectMonthlyImpactCents(validated.rule!, {
    purchases: nessiePurchases.map(purchaseEventFromNessie),
    historyMonths: 6,
    monthlyIncomeCents: entry.monthlyIncomeCents,
    currentCheckingBalanceCents: checking.balance,
  });

  return NextResponse.json({
    status: "preview",
    dsl: validated.rule,
    explanation: "Rule assembled from the form.",
    projectedMonthlyImpactCents,
  });
}
