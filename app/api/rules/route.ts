import { NextResponse } from "next/server";
import { validateRuleDsl } from "@/src/dsl/schema";
import { findDirectoryEntry } from "@/src/db/directory";
import { prisma } from "@/src/db/prisma";

/**
 * POST activates a previously-previewed rule (never called directly with
 * unvalidated input from the compiler -- the client must have already shown the
 * human a preview). We re-validate here too, since this is the actual write path.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as {
    customerId?: string;
    name?: string;
    sourceText?: string | null;
    dsl?: unknown;
  };
  if (!body.customerId || !body.dsl) {
    return NextResponse.json({ error: "customerId and dsl are required" }, { status: 400 });
  }
  const entry = findDirectoryEntry(body.customerId);
  if (!entry) return NextResponse.json({ error: "customer not found" }, { status: 404 });

  const validated = validateRuleDsl(body.dsl);
  if (!validated.ok) {
    return NextResponse.json({ error: "dsl failed validation", details: validated.errors }, { status: 400 });
  }

  const rule = await prisma.rule.create({
    data: {
      customerId: entry.customerId,
      accountId: entry.checkingAccountId,
      savingsAccountId: entry.savingsAccountId,
      name: body.name ?? "Custom rule",
      sourceText: body.sourceText ?? null,
      dsl: validated.rule as never,
    },
  });

  return NextResponse.json({ rule });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const customerId = url.searchParams.get("customerId");
  if (!customerId) return NextResponse.json({ error: "customerId is required" }, { status: 400 });
  const rules = await prisma.rule.findMany({ where: { customerId }, orderBy: { createdAt: "desc" } });
  return NextResponse.json({ rules });
}
