import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { nessieStore, NessieMockError, NessieStore } from "./store";

/**
 * Self-hosted stand-in for api.nessieisreal.com. Spec explicitly allows this when the
 * real Nessie API is unavailable at build time (it requires a hosted-account signup,
 * which rule #2 of this build forbids). Routes mirror Nessie's real shape:
 *   POST /customers, GET /customers/:id/accounts, POST /customers/:id/accounts
 *   POST /accounts/:id/purchases, GET /accounts/:id/purchases
 *   POST /accounts/:id/transfers
 *
 * CHAOS_RATE env var (0..1) makes a fraction of requests fail with a transient 503 so
 * the client's retry logic has something real to prove itself against.
 */
export function createNessieMockServer(store: NessieStore = nessieStore): Express {
  const app = express();
  app.use(express.json());

  const chaosRate = Number(process.env.NESSIE_MOCK_CHAOS_RATE ?? "0");
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (chaosRate > 0 && Math.random() < chaosRate) {
      res.status(503).json({ message: "transient mock failure (chaos mode)" });
      return;
    }
    next();
  });

  app.get("/health", (_req, res) => res.json({ ok: true }));

  app.post("/customers", (req, res) => {
    const customer = store.createCustomer(req.body);
    res.status(201).json(customer);
  });

  app.post("/customers/:customerId/accounts", (req, res) => {
    const account = store.createAccount({ ...req.body, customer_id: req.params.customerId });
    res.status(201).json(account);
  });

  app.get("/customers/:customerId/accounts", (req, res) => {
    res.json(store.listAccountsForCustomer(req.params.customerId));
  });

  app.get("/accounts/:accountId", (req, res) => {
    const account = store.getAccount(req.params.accountId);
    if (!account) return res.status(404).json({ message: "account not found" });
    res.json(account);
  });

  app.post("/accounts/:accountId/purchases", (req, res) => {
    const purchase = store.createPurchase({ ...req.body, payer_id: req.params.accountId });
    res.status(201).json(purchase);
  });

  // Bulk-insert variant used only by the seeding script so that generating 6 months
  // of history for 500 customers doesn't require one HTTP round trip per purchase.
  // Not part of the real Nessie API; harmless extension of our self-hosted mock.
  app.post("/accounts/:accountId/purchases/bulk", (req, res) => {
    const items = req.body.purchases as Array<Record<string, unknown>>;
    const created = items.map((item) =>
      store.createPurchase({ ...item, payer_id: req.params.accountId } as never),
    );
    res.status(201).json(created);
  });

  app.get("/accounts/:accountId/purchases", (req, res) => {
    res.json(store.listPurchasesForAccount(req.params.accountId));
  });

  // Mirrors the real Nessie API's /deposits resource (external money arriving, e.g.
  // a paycheck) and, like /purchases/bulk, adds a bulk variant for fast seeding.
  app.post("/accounts/:accountId/deposits/bulk", (req, res) => {
    const items = req.body.deposits as Array<Record<string, unknown>>;
    const created = items.map((item) =>
      store.createDeposit({ ...item, payee_id: req.params.accountId } as never),
    );
    res.status(201).json(created);
  });

  app.get("/accounts/:accountId/deposits", (req, res) => {
    res.json(store.listDepositsForAccount(req.params.accountId));
  });

  app.post("/accounts/:accountId/transfers", (req, res) => {
    try {
      const { transfer, wasDuplicate } = store.createTransfer({
        payer_id: req.params.accountId,
        payee_id: req.body.payee_id,
        amount: req.body.amount,
        idempotency_key: req.body.idempotency_key,
      });
      res.status(wasDuplicate ? 200 : 201).json(transfer);
    } catch (err) {
      if (err instanceof NessieMockError) {
        res.status(err.status).json({ message: err.message });
      } else {
        res.status(500).json({ message: "internal mock error" });
      }
    }
  });

  return app;
}

export function startNessieMockServer(port: number, store?: NessieStore) {
  const app = createNessieMockServer(store);
  return app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`[nessie-mock] listening on http://localhost:${port}`);
  });
}
