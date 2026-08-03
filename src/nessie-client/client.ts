import type {
  NessieAccount,
  NessieCustomer,
  NessieDeposit,
  NessiePurchase,
  NessieTransfer,
} from "../nessie-mock/types";

export interface NessieClientOptions {
  baseUrl: string;
  apiKey: string;
  maxRetries?: number;
  baseDelayMs?: number;
  fetchImpl?: typeof fetch;
}

export class NessieApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

/**
 * Thin HTTP client for the Nessie API (real or self-hosted mock -- same base URL
 * contract). Retries transient failures (429/5xx and network errors) with capped
 * exponential backoff so the seeding + engine layers above don't have to think about
 * flakiness.
 */
export class NessieClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: NessieClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.apiKey = opts.apiKey;
    this.maxRetries = opts.maxRetries ?? 4;
    this.baseDelayMs = opts.baseDelayMs ?? 50;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}${path.includes("?") ? "&" : "?"}key=${this.apiKey}`;
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      attempt += 1;
      try {
        const res = await this.fetchImpl(url, {
          method,
          headers: { "content-type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        if (!res.ok) {
          const isRetryable = RETRYABLE_STATUSES.has(res.status);
          if (isRetryable && attempt <= this.maxRetries) {
            await this.backoff(attempt);
            continue;
          }
          const text = await res.text().catch(() => res.statusText);
          throw new NessieApiError(res.status, text);
        }
        if (res.status === 204) return undefined as T;
        return (await res.json()) as T;
      } catch (err) {
        if (err instanceof NessieApiError) throw err;
        // Network-level failure (connection refused, reset, etc.)
        if (attempt <= this.maxRetries) {
          await this.backoff(attempt);
          continue;
        }
        throw err;
      }
    }
  }

  private backoff(attempt: number): Promise<void> {
    const delay = this.baseDelayMs * 2 ** (attempt - 1);
    return new Promise((resolve) => setTimeout(resolve, delay));
  }

  createCustomer(input: Omit<NessieCustomer, "_id">): Promise<NessieCustomer> {
    return this.request("POST", "/customers", input);
  }

  createAccount(customerId: string, input: Omit<NessieAccount, "_id" | "customer_id">): Promise<NessieAccount> {
    return this.request("POST", `/customers/${customerId}/accounts`, input);
  }

  listAccounts(customerId: string): Promise<NessieAccount[]> {
    return this.request("GET", `/customers/${customerId}/accounts`);
  }

  getAccount(accountId: string): Promise<NessieAccount> {
    return this.request("GET", `/accounts/${accountId}`);
  }

  createPurchase(
    accountId: string,
    input: Omit<NessiePurchase, "_id" | "status" | "medium" | "payer_id">,
  ): Promise<NessiePurchase> {
    return this.request("POST", `/accounts/${accountId}/purchases`, input);
  }

  listPurchases(accountId: string): Promise<NessiePurchase[]> {
    return this.request("GET", `/accounts/${accountId}/purchases`);
  }

  createPurchasesBulk(
    accountId: string,
    purchases: Array<Omit<NessiePurchase, "_id" | "status" | "medium" | "payer_id">>,
  ): Promise<NessiePurchase[]> {
    return this.request("POST", `/accounts/${accountId}/purchases/bulk`, { purchases });
  }

  createTransfer(
    fromAccountId: string,
    input: { payee_id: string; amount: number; idempotency_key: string },
  ): Promise<NessieTransfer> {
    return this.request("POST", `/accounts/${fromAccountId}/transfers`, input);
  }

  createDepositsBulk(
    accountId: string,
    deposits: Array<Omit<NessieDeposit, "_id" | "status" | "type" | "payee_id">>,
  ): Promise<NessieDeposit[]> {
    return this.request("POST", `/accounts/${accountId}/deposits/bulk`, { deposits });
  }

  listDeposits(accountId: string): Promise<NessieDeposit[]> {
    return this.request("GET", `/accounts/${accountId}/deposits`);
  }
}

export function nessieClientFromEnv(): NessieClient {
  return new NessieClient({
    baseUrl: process.env.NESSIE_BASE_URL ?? "http://localhost:4173",
    apiKey: process.env.NESSIE_API_KEY ?? "local-mock-key",
  });
}
