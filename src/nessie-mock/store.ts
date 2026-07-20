import type {
  NessieAccount,
  NessieCustomer,
  NessiePurchase,
  NessieTransfer,
} from "./types.js";

/**
 * In-memory bank state for the self-hosted Nessie-compatible mock.
 * Kept as one small module so seeding scripts and the HTTP server both use the
 * exact same data structures (no drift between "what we seed" and "what we serve").
 */
export class NessieStore {
  customers = new Map<string, NessieCustomer>();
  accounts = new Map<string, NessieAccount>();
  purchases = new Map<string, NessiePurchase>();
  transfers = new Map<string, NessieTransfer>();
  private idempotencyIndex = new Map<string, string>(); // idempotency_key -> transfer _id
  private seq = 0;

  nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}_${this.seq.toString(36)}`;
  }

  createCustomer(input: Omit<NessieCustomer, "_id">): NessieCustomer {
    const customer: NessieCustomer = { _id: this.nextId("cust"), ...input };
    this.customers.set(customer._id, customer);
    return customer;
  }

  createAccount(input: Omit<NessieAccount, "_id">): NessieAccount {
    const account: NessieAccount = { _id: this.nextId("acc"), ...input };
    this.accounts.set(account._id, account);
    return account;
  }

  createPurchase(input: Omit<NessiePurchase, "_id" | "status" | "medium">): NessiePurchase {
    const purchase: NessiePurchase = {
      _id: this.nextId("purch"),
      medium: "balance",
      status: "completed",
      ...input,
    };
    this.purchases.set(purchase._id, purchase);
    const account = this.accounts.get(purchase.payer_id);
    if (account) account.balance -= purchase.amount;
    return purchase;
  }

  getAccount(id: string): NessieAccount | undefined {
    return this.accounts.get(id);
  }

  listPurchasesForAccount(accountId: string): NessiePurchase[] {
    return [...this.purchases.values()]
      .filter((p) => p.payer_id === accountId)
      .sort((a, b) => a.purchase_date.localeCompare(b.purchase_date));
  }

  listAccountsForCustomer(customerId: string): NessieAccount[] {
    return [...this.accounts.values()].filter((a) => a.customer_id === customerId);
  }

  /**
   * Create a transfer. If a transfer with the same idempotency_key already exists,
   * return the EXISTING transfer instead of creating a new one and DO NOT move money
   * again. This is what makes the execution engine's retries/replays safe.
   */
  createTransfer(input: {
    payer_id: string;
    payee_id: string;
    amount: number;
    idempotency_key: string;
  }): { transfer: NessieTransfer; wasDuplicate: boolean } {
    const existingId = this.idempotencyIndex.get(input.idempotency_key);
    if (existingId) {
      const existing = this.transfers.get(existingId);
      if (existing) return { transfer: existing, wasDuplicate: true };
    }

    if (input.amount <= 0) {
      throw new NessieMockError(400, "amount must be positive");
    }
    const payer = this.accounts.get(input.payer_id);
    const payee = this.accounts.get(input.payee_id);
    if (!payer || !payee) throw new NessieMockError(404, "account not found");

    const transfer: NessieTransfer = {
      _id: this.nextId("trf"),
      type: "transfer",
      transaction_date: new Date().toISOString(),
      status: "completed",
      amount: input.amount,
      payer_id: input.payer_id,
      payee_id: input.payee_id,
      idempotency_key: input.idempotency_key,
    };
    payer.balance -= input.amount;
    payee.balance += input.amount;
    this.transfers.set(transfer._id, transfer);
    this.idempotencyIndex.set(input.idempotency_key, transfer._id);
    return { transfer, wasDuplicate: false };
  }

  reset(): void {
    this.customers.clear();
    this.accounts.clear();
    this.purchases.clear();
    this.transfers.clear();
    this.idempotencyIndex.clear();
    this.seq = 0;
  }
}

export class NessieMockError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// Singleton used by the HTTP server process.
export const nessieStore = new NessieStore();
