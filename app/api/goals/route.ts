import { NextResponse } from "next/server";
import { findDirectoryEntry } from "@/src/db/directory";
import { prisma } from "@/src/db/prisma";

export async function POST(request: Request) {
  const body = (await request.json()) as { customerId?: string; ruleId?: string | null; name?: string; targetCents?: number };
  if (!body.customerId || !body.name || !body.targetCents) {
    return NextResponse.json({ error: "customerId, name, and targetCents are required" }, { status: 400 });
  }
  const entry = findDirectoryEntry(body.customerId);
  if (!entry) return NextResponse.json({ error: "customer not found" }, { status: 404 });

  const goal = await prisma.goal.create({
    data: {
      customerId: entry.customerId,
      ruleId: body.ruleId ?? null,
      name: body.name,
      targetCents: body.targetCents,
    },
  });
  return NextResponse.json({ goal });
}
