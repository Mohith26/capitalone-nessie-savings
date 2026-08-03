import type { Condition, RuleDsl } from "../dsl/schema";
import type { NessiePurchase } from "../nessie-mock/types";

export interface PurchaseEvent {
  transactionId: string;
  accountId: string;
  merchantCategory: string;
  amountCents: number;
  date: string;
}

export function purchaseEventFromNessie(purchase: NessiePurchase): PurchaseEvent {
  return {
    transactionId: purchase._id,
    accountId: purchase.payer_id,
    merchantCategory: purchase.merchant_category,
    amountCents: purchase.amount,
    date: purchase.purchase_date,
  };
}

function conditionMatchesPurchase(condition: Condition, event: PurchaseEvent, checkingBalanceCents: number): boolean {
  switch (condition.type) {
    case "merchant_category":
      return condition.categories.includes(event.merchantCategory as never);
    case "amount_range": {
      if (condition.minCents !== undefined && event.amountCents < condition.minCents) return false;
      if (condition.maxCents !== undefined && event.amountCents > condition.maxCents) return false;
      return true;
    }
    case "balance_floor":
      return checkingBalanceCents >= condition.minCents;
    default:
      return false;
  }
}

/** Does this rule's trigger + conditions match the given purchase event? */
export function ruleMatchesPurchase(rule: RuleDsl, event: PurchaseEvent, checkingBalanceCents: number): boolean {
  if (rule.trigger.type !== "purchase") return false;
  return rule.conditions.every((c) => conditionMatchesPurchase(c, event, checkingBalanceCents));
}

/** Raw (pre-safety-rail) transfer amount the rule's action would produce for this purchase. */
export function computeRawTransferAmount(rule: RuleDsl, event: PurchaseEvent): number {
  switch (rule.action.type) {
    case "round_up": {
      const toCents = rule.action.toCents;
      const remainder = event.amountCents % toCents;
      const roundedUp = remainder === 0 ? event.amountCents : event.amountCents + (toCents - remainder);
      return roundedUp - event.amountCents;
    }
    case "fixed_transfer":
      return rule.action.amountCents;
    case "percent_of_deposit":
      return 0; // not applicable to purchase events
  }
}
