import type { PrismaClient } from "@prisma/client";
import type { RuleDsl } from "../dsl/schema.js";
import type { NessieClient } from "../nessie-client/client.js";
import { idempotencyKeyFor } from "./idempotency.js";
import { computeRawTransferAmount, ruleMatchesPurchase, type PurchaseEvent } from "./matching.js";
import { checkSafetyRails } from "./safety.js";

export interface ActiveRule {
  id: string;
  customerId: string;
  accountId: string; // checking account this rule watches
  savingsAccountId: string;
  dsl: RuleDsl;
}

export type ExecutionOutcome =
  | { status: "transferred"; transferId: string; amountCents: number; idempotencyKey: string }
  | { status: "duplicate_skipped"; transferId: string; idempotencyKey: string }
  | { status: "not_matched" }
  | { status: "blocked"; reason: string };

/**
 * Process one purchase event against one rule. This is the single seam through
 * which every transfer in the system flows, whether called from the live "new
 * purchase" webhook path, the simulation batch runner, or a replay/retry -- which is
 * exactly what makes idempotency a property of the engine rather than of any one
 * caller.
 */
export async function processPurchaseForRule(
  prisma: PrismaClient,
  nessie: NessieClient,
  rule: ActiveRule,
  event: PurchaseEvent,
  currentCheckingBalanceCents: number,
): Promise<ExecutionOutcome> {
  if (!ruleMatchesPurchase(rule.dsl, event, currentCheckingBalanceCents)) {
    return { status: "not_matched" };
  }

  const rawAmount = computeRawTransferAmount(rule.dsl, event);
  const idempotencyKey = idempotencyKeyFor(rule.id, event.transactionId);

  // Layer 1: application-level idempotency check. If we've already recorded a
  // transfer for this (rule, transaction) pair, this is a replay -- do nothing.
  const existing = await prisma.transfer.findUnique({ where: { idempotencyKey } });
  if (existing) {
    return { status: "duplicate_skipped", transferId: existing.id, idempotencyKey };
  }

  const alreadyToday = await prisma.transfer.aggregate({
    where: { ruleId: rule.id, transactionDate: event.date },
    _sum: { amountCents: true },
  });
  const alreadyTransferredTodayCents = alreadyToday._sum.amountCents ?? 0;

  const safetyResult = checkSafetyRails({
    rule: rule.dsl,
    proposedAmountCents: rawAmount,
    currentCheckingBalanceCents,
    alreadyTransferredTodayCents,
  });
  if (!safetyResult.allowed) {
    return { status: "blocked", reason: safetyResult.reason };
  }

  // Layer 2: Nessie's own idempotency index (defense in depth if our DB write races).
  const nessieTransfer = await nessie.createTransfer(rule.accountId, {
    payee_id: rule.savingsAccountId,
    amount: safetyResult.amountCents,
    idempotency_key: idempotencyKey,
  });

  try {
    const created = await prisma.transfer.create({
      data: {
        idempotencyKey,
        ruleId: rule.id,
        triggeringTransactionId: event.transactionId,
        customerId: rule.customerId,
        fromAccountId: rule.accountId,
        toAccountId: rule.savingsAccountId,
        amountCents: safetyResult.amountCents,
        transactionDate: event.date,
        nessieTransferId: nessieTransfer._id,
      },
    });
    return { status: "transferred", transferId: created.id, amountCents: created.amountCents, idempotencyKey };
  } catch (err) {
    // Layer 3: unique-constraint race -- two concurrent callers both passed the
    // findUnique check above and both tried to insert. Whoever loses the race just
    // reads back the winner's row instead of erroring.
    const isUniqueViolation = (err as { code?: string }).code === "P2002";
    if (isUniqueViolation) {
      const winner = await prisma.transfer.findUniqueOrThrow({ where: { idempotencyKey } });
      return { status: "duplicate_skipped", transferId: winner.id, idempotencyKey };
    }
    throw err;
  }
}
