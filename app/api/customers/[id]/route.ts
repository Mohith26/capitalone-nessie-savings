import { NextResponse } from "next/server";
import { findDirectoryEntry } from "@/src/db/directory";
import { nessieClientFromEnv } from "@/src/nessie-client/client";
import { prisma } from "@/src/db/prisma";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const entry = findDirectoryEntry(params.id);
  if (!entry) return NextResponse.json({ error: "customer not found" }, { status: 404 });

  const nessie = nessieClientFromEnv();
  const [checking, savings, rules, goals] = await Promise.all([
    nessie.getAccount(entry.checkingAccountId),
    nessie.getAccount(entry.savingsAccountId),
    prisma.rule.findMany({ where: { customerId: entry.customerId }, orderBy: { createdAt: "desc" } }),
    prisma.goal.findMany({ where: { customerId: entry.customerId } }),
  ]);

  const transfers = await prisma.transfer.findMany({
    where: { customerId: entry.customerId },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { rule: { select: { name: true, sourceText: true } } },
  });

  return NextResponse.json({
    entry,
    checking,
    savings,
    rules,
    goals,
    transfers: transfers.map((t) => ({
      id: t.id,
      amountCents: t.amountCents,
      transactionDate: t.transactionDate,
      triggeringTransactionId: t.triggeringTransactionId,
      createdAt: t.createdAt,
      ruleName: t.rule?.name ?? null,
      ruleSourceText: t.rule?.sourceText ?? null,
    })),
  });
}
