// Shapes mirror Capital One's real Nessie API (api.nessieisreal.com) closely enough
// that src/nessie-client is swappable between this mock and the real service just by
// changing NESSIE_BASE_URL / NESSIE_API_KEY.

export interface NessieCustomer {
  _id: string;
  first_name: string;
  last_name: string;
  address: {
    street_number: string;
    street_name: string;
    city: string;
    state: string;
    zip: string;
  };
}

export type NessieAccountType = "Checking" | "Savings";

export interface NessieAccount {
  _id: string;
  type: NessieAccountType;
  nickname: string;
  rewards: number;
  balance: number; // in cents (mock deviates from real Nessie's dollars for money-as-integers correctness)
  customer_id: string;
}

export interface NessiePurchase {
  _id: string;
  merchant_id: string;
  merchant_name: string;
  merchant_category: string;
  medium: "balance";
  purchase_date: string; // ISO date
  amount: number; // cents
  status: "completed";
  payer_id: string; // account id
}

export interface NessieTransfer {
  _id: string;
  type: "transfer";
  transaction_date: string;
  status: "completed";
  amount: number; // cents
  payer_id: string;
  payee_id: string;
  idempotency_key: string;
}
