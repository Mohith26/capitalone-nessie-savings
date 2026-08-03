# RoundUps — Programmable Micro-Savings on Capital One's Nessie API

A micro-savings platform built on **Capital One's Nessie** mock-banking API (the house API at
Capital One's hackathons and DevExchange). Customers describe savings rules in plain English —
*"save $5 every time I order coffee"* — and a local LLM compiles them into a strict, **zod-validated
rules DSL** with hard safety rails. Matching purchases fire **idempotent** transfers into savings,
recorded in an **append-only ledger** where every transfer is traceable to the rule and the exact
transaction that triggered it. A 500-customer simulation projects savings outcomes across income /
spend personas.

> **Why this shape:** it targets Capital One SWE recruiting signals — their own developer tooling
> (Nessie), fintech correctness (money as integers, idempotent transfers, audit trails), and a
> *risk-conscious* use of an LLM (the model proposes structure; deterministic code owns every
> money-critical number and every safety decision).

Built to spec #33. See **[RESULTS.md](./RESULTS.md)** for every measured number with its exact
reproduce command, and **[BULLETS.md](./BULLETS.md)** for the resume bullets those numbers back.

---

## Headline results (measured 2026-08-03 — see RESULTS.md)

| Metric | Value |
|---|---|
| Plain-English → DSL exact-match (30-phrasing eval) | **90.0% (27/30)** |
| Unsafe-request rejection accuracy | **87.5% (7/8)** |
| Real ledger transfers audited | **9,951** |
| Transfers traceable to rule + triggering txn | **100.0%** |
| Duplicate transfers (after full replay) | **0** |
| Synthetic customers simulated (6 months) | **500** |
| Median saver | **$69.38 / month** |
| Test suite | **42/42 passing** |

## Architecture

```
Nessie mock (src/nessie-mock)  ── customers / accounts / purchases / deposits / transfers
        ▲  (HTTP, Nessie-compatible routes)
        │
NessieClient (src/nessie-client) ── retries 429/5xx + network errors w/ capped backoff
        │
Rules DSL (src/dsl/schema.ts, zod) ── triggers × conditions × actions + safety rails
        │
Execution engine (src/engine) ── match → compute → enforce safety → idempotent transfer → ledger
        │                          idempotency key = sha256(ruleId, triggeringTransactionId)
        ├── Postgres ledger (prisma) ── append-only Transfer rows, Rule + Goal tables
        │
NL compiler (src/compiler) ── heuristic guard → Ollama JSON → zod validate → history impact → PREVIEW
        │                      (a rule is NEVER activated without an explicit confirm)
        │
Simulation (src/sim) ── replay 500 customers × rule mixes → savings distributions
        │
Dashboard (app/, Next.js 14 + Recharts) ── accounts, plain-English rule add, goal thermometers,
                                            transfer history w/ rule attribution, sim charts
```

### Design decisions that matter

- **Money is always integer cents.** No floats anywhere in the money path.
- **The LLM owns the "what", deterministic code owns the "how safe".** The model proposes
  trigger/conditions/action; `src/compiler/defaults.ts` assigns the balance floor and daily cap,
  and `src/engine/safety.ts` re-checks *every* transfer at execution time (balances change between
  rule creation and firing). Three independent safety layers: a pre-model heuristic guard, the
  model's own refusal, and the zod validator + runtime rails.
- **Idempotency is a property of the engine, not the caller.** The live "new purchase" path, the
  batch runner, and any retry/replay all flow through one function keyed by
  `hash(ruleId, transactionId)`, with defense in depth (app-level check → Nessie idempotency index →
  DB unique constraint on race). Replaying an entire 9,951-transfer batch adds zero rows.
- **Preview before activation, always.** `compilePlainEnglishRule` returns a preview (with a
  history-projected monthly impact) or a rejection-with-reason; it never activates anything.

## Tech stack

TypeScript · Next.js 14 (App Router) · zod · Prisma + PostgreSQL · Ollama (local LLM) · Recharts ·
Express (mock server) · Vitest · faker.

---

## Reproduce the results

### Prerequisites (all free / local)

- **Node** ≥ 20 (built on v22).
- **PostgreSQL** reachable at the `DATABASE_URL` in `.env` (default `localhost:5544`, db `roundups`).
- **[Ollama](https://ollama.com)** running locally with the model pulled: `ollama pull llama3.1:8b`.

```bash
cp .env.example .env          # local URLs only; no secrets
npm install
npm run db:push               # create the Prisma schema in Postgres
npm run mock:start            # start the Nessie-compatible mock on :4173 (leave running)
```

Then, in another shell:

```bash
npm run seed          # Phase 1: 500 customers, 6-month history          → data/directory.json
npm test              # Phases 1–2: 42 tests incl. real-DB idempotency + adversarial DSL
npm run ledger:batch  # Phase 2: drive 50 customers' real purchases through the engine + REPLAY
npm run audit         # Phase 2: audit the real ledger (100% attributed, 0 duplicates)
npm run eval          # Phase 3: 30-phrasing compiler eval + 8 unsafe requests → eval/results.json
npm run sim           # Phase 4: simulate 500 customers × rule mixes       → data/simulation-*.json
npm run demo          # Phase 4: end-to-end (english rule → preview → activate → 1 attributed transfer)
npm run dev           # optional: the dashboard at http://localhost:3000
```

`npm run eval`, `npm run demo`, `npm run ledger:batch`, and the idempotency tests hit the **real**
mock + Postgres (+ Ollama for eval/demo) — no mocking of the systems under test.

## The rules DSL (shape)

```jsonc
{
  "trigger":   { "type": "purchase" | "deposit" | "schedule", "weekday?": 0-6 },
  "conditions": [ /* AND-ed */
    { "type": "merchant_category", "categories": ["coffee", ...] },
    { "type": "amount_range", "minCents?": 0, "maxCents?": 5000 },
    { "type": "balance_floor", "minCents": 25000 }
  ],
  "action": { "type": "round_up",  "toCents": 100|500|1000 }   // nearest $1/$5/$10
          |  { "type": "fixed_transfer", "amountCents": 500 }
          |  { "type": "percent_of_deposit", "percent": 10 },  // deposit trigger only
  "safety": { "balanceFloorCents": 2500, "dailyCapCents": 3000 } // ALWAYS present, ALWAYS enforced
}
```

Merchant categories: `coffee, groceries, restaurants, rideshare, entertainment, utilities, rent,
shopping, subscriptions, gas`.

## Dashboard

- `/accounts` — the 500 seeded customers.
- `/accounts/[id]` — balances, goal thermometers, **add a rule in plain English** (preview →
  activate), active rules, and a transfer-history table that shows each transfer's rule **and its
  triggering transaction id** (the audit trail, visible in the UI).
- `/simulation` — Recharts distributions of median/quartile savings by rule mix and by persona.

---

## Limitations & honest caveats

- **Nessie is mocked locally.** `api.nessieisreal.com` requires a hosted student account; per the
  spec, a self-hosted **Nessie-compatible** mock (`src/nessie-mock`) is used instead, with routes
  mirroring the real API so `NessieClient` is swappable by changing `NESSIE_BASE_URL`. No hosted
  Capital One account was created.
- **The NL compiler is a local 8B model.** Ollama `llama3.1:8b` stands in for the spec's
  "Claude/GPT function-calling" so the project is free and offline. The **90.0% / 87.5%** compiler
  scores are therefore a *floor* — a hosted frontier model would very likely score higher. Three
  specific miscompiles and one missed unexpressible request are enumerated in RESULTS.md.
- **The 500-customer savings simulation is in-memory** (it reuses the engine's exact matching +
  safety functions but doesn't write 500×~175 ledger rows). The 100%-attribution / 0-duplicate
  ledger guarantee is instead measured on a **real** 9,951-transfer Postgres + Nessie batch.
- **Rule-mix outperformance percentages are structural** (a percent-of-paycheck rule moves far more
  than round-ups by construction) — read them as "different savings magnitudes", not a tuned edge.
- Out of scope (per spec): real bank connections, real money, credit features, mobile app.

## Layout

```
app/                 Next.js 14 dashboard (pages + API routes)
components/           GoalThermometer, SimulationCharts (Recharts)
src/nessie-mock/      Nessie-compatible mock server + in-memory store
src/nessie-client/    retrying HTTP client
src/dsl/              zod rules DSL + validator
src/engine/           matching, safety rails, idempotency, execution
src/compiler/         heuristic guard, Ollama call, defaults, impact projection, eval compare
src/personas/         faker personas + purchase-history generator
src/sim/              rule mixes + in-memory simulation
scripts/              seed, simulate, eval-compiler, e2e-demo, ledger-batch, ledger-audit, start-mock
test/                 vitest suite (42 tests)
prisma/schema.prisma  Rule / Transfer (append-only ledger) / Goal
eval/                 30 phrasings + 8 unsafe requests + last results.json
data/                 seed directory + simulation outputs
```
