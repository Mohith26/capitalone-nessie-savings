import { describe, expect, it } from "vitest";
import { NessieStore } from "../src/nessie-mock/store";

describe("NessieStore balance math", () => {
  it("decrements the payer's balance on purchase and increments on deposit", () => {
    const store = new NessieStore();
    const customer = store.createCustomer({
      first_name: "A",
      last_name: "B",
      address: { street_number: "1", street_name: "Main", city: "X", state: "TX", zip: "00000" },
    });
    const checking = store.createAccount({
      type: "Checking",
      nickname: "test",
      rewards: 0,
      balance: 10000,
      customer_id: customer._id,
    });

    store.createPurchase({
      merchant_id: "m1",
      merchant_name: "Coffee",
      merchant_category: "coffee",
      purchase_date: "2026-01-01",
      amount: 450,
      payer_id: checking._id,
    });
    expect(store.getAccount(checking._id)?.balance).toBe(9550);

    store.createDeposit({
      transaction_date: "2026-01-02",
      amount: 500000,
      payee_id: checking._id,
      description: "Payroll",
    });
    expect(store.getAccount(checking._id)?.balance).toBe(509550);
  });

  it("createTransfer is idempotent at the store level: same key never moves money twice", () => {
    const store = new NessieStore();
    const customer = store.createCustomer({
      first_name: "A",
      last_name: "B",
      address: { street_number: "1", street_name: "Main", city: "X", state: "TX", zip: "00000" },
    });
    const checking = store.createAccount({ type: "Checking", nickname: "c", rewards: 0, balance: 10000, customer_id: customer._id });
    const savings = store.createAccount({ type: "Savings", nickname: "s", rewards: 0, balance: 0, customer_id: customer._id });

    const first = store.createTransfer({ payer_id: checking._id, payee_id: savings._id, amount: 500, idempotency_key: "k1" });
    const second = store.createTransfer({ payer_id: checking._id, payee_id: savings._id, amount: 500, idempotency_key: "k1" });

    expect(first.wasDuplicate).toBe(false);
    expect(second.wasDuplicate).toBe(true);
    expect(first.transfer._id).toBe(second.transfer._id);
    expect(store.getAccount(savings._id)?.balance).toBe(500); // moved exactly once
    expect(store.getAccount(checking._id)?.balance).toBe(9500);
  });

  it("rejects a transfer with a non-positive amount", () => {
    const store = new NessieStore();
    const customer = store.createCustomer({
      first_name: "A",
      last_name: "B",
      address: { street_number: "1", street_name: "Main", city: "X", state: "TX", zip: "00000" },
    });
    const checking = store.createAccount({ type: "Checking", nickname: "c", rewards: 0, balance: 10000, customer_id: customer._id });
    const savings = store.createAccount({ type: "Savings", nickname: "s", rewards: 0, balance: 0, customer_id: customer._id });

    expect(() =>
      store.createTransfer({ payer_id: checking._id, payee_id: savings._id, amount: 0, idempotency_key: "k2" }),
    ).toThrow();
    expect(() =>
      store.createTransfer({ payer_id: checking._id, payee_id: savings._id, amount: -100, idempotency_key: "k3" }),
    ).toThrow();
  });
});
