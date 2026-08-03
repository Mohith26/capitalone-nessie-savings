import type { RuleDsl } from "../dsl/schema";
import { computeRawTransferAmount, ruleMatchesPurchase, type PurchaseEvent } from "../engine/matching";
import { checkSafetyRails } from "../engine/safety";

export interface SimEvent {
  type: "purchase" | "deposit";
  date: string;
  amountCents: number; // purchase amount or deposit amount
  merchantCategory?: string;
}

export interface SimulationResult {
  transfersExecuted: number;
  transfersBlocked: number;
  totalSavedCents: number;
  endingCheckingCents: number;
  endingSavingsCents: number;
}

/**
 * In-memory replay of one customer's history against one rule mix, using the EXACT
 * SAME matching (`ruleMatchesPurchase`, `computeRawTransferAmount`) and safety-rail
 * (`checkSafetyRails`) functions the live engine uses -- this is a simulation of
 * aggregate outcomes, not a re-implementation of the rules. The live engine's
 * per-transfer idempotency/ledger correctness is proven separately (see
 * test/engine-idempotency.test.ts); this module answers a different question ("how
 * much would this customer have saved"), which is why it tracks balances in memory
 * instead of writing one ledger row per transfer through Postgres+Nessie for 500
 * customers x ~1,000 events each.
 */
export function simulateCustomer(
  purchases: PurchaseEvent[],
  monthlyIncomeCents: number,
  historyMonths: number,
  startingCheckingCents: number,
  startingSavingsCents: number,
  ruleMix: RuleDsl[],
): SimulationResult {
  const events: SimEvent[] = [
    ...purchases.map((p) => ({
      type: "purchase" as const,
      date: p.date,
      amountCents: p.amountCents,
      merchantCategory: p.merchantCategory,
    })),
    ...monthlyDepositEvents(purchases, monthlyIncomeCents, historyMonths),
  ].sort((a, b) => a.date.localeCompare(b.date));

  let checking = startingCheckingCents;
  let savings = startingSavingsCents;
  let transfersExecuted = 0;
  let transfersBlocked = 0;
  let totalSaved = 0;
  const dailyTransferredByRule: Array<Map<string, number>> = ruleMix.map(() => new Map());

  for (const event of events) {
    if (event.type === "purchase") {
      checking -= event.amountCents;
    } else {
      checking += event.amountCents;
    }

    ruleMix.forEach((rule, ruleIndex) => {
      const raw = computeRawAmountForEvent(rule, event, checking);
      if (raw === null) return; // trigger/action doesn't apply to this event

      const dailyMap = dailyTransferredByRule[ruleIndex];
      const alreadyToday = dailyMap.get(event.date) ?? 0;
      const result = checkSafetyRails({
        rule,
        proposedAmountCents: raw,
        currentCheckingBalanceCents: checking,
        alreadyTransferredTodayCents: alreadyToday,
      });

      if (result.allowed) {
        checking -= result.amountCents;
        savings += result.amountCents;
        totalSaved += result.amountCents;
        transfersExecuted += 1;
        dailyMap.set(event.date, alreadyToday + result.amountCents);
      } else {
        transfersBlocked += 1;
      }
    });
  }

  return {
    transfersExecuted,
    transfersBlocked,
    totalSavedCents: totalSaved,
    endingCheckingCents: checking,
    endingSavingsCents: savings,
  };
}

function computeRawAmountForEvent(rule: RuleDsl, event: SimEvent, checkingBalanceCents: number): number | null {
  if (event.type === "purchase" && rule.trigger.type === "purchase") {
    const purchaseEvent: PurchaseEvent = {
      transactionId: `${event.date}-${event.merchantCategory}`,
      accountId: "sim",
      merchantCategory: event.merchantCategory ?? "shopping",
      amountCents: event.amountCents,
      date: event.date,
    };
    if (!ruleMatchesPurchase(rule, purchaseEvent, checkingBalanceCents)) return null;
    return computeRawTransferAmount(rule, purchaseEvent);
  }
  if (event.type === "deposit" && rule.trigger.type === "deposit" && rule.action.type === "percent_of_deposit") {
    return Math.round(event.amountCents * (rule.action.percent / 100));
  }
  return null;
}

function monthlyDepositEvents(
  purchases: PurchaseEvent[],
  monthlyIncomeCents: number,
  historyMonths: number,
): SimEvent[] {
  if (purchases.length === 0) return [];
  const firstDate = new Date(purchases[0].date);
  const events: SimEvent[] = [];
  for (let m = 0; m < historyMonths; m += 1) {
    const date = new Date(firstDate);
    date.setMonth(firstDate.getMonth() + m);
    date.setDate(1);
    events.push({ type: "deposit", date: date.toISOString().slice(0, 10), amountCents: monthlyIncomeCents });
  }
  return events;
}
