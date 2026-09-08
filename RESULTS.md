# RESULTS: RoundUps (Nessie API)

All numbers below were produced by real runs on **2026-08-03** on this machine.
Each is emitted by the command shown and persisted to the JSON file noted. Where the
model or a safety rail behaved imperfectly, the imperfect number is reported as-is.

## Environment (what "real" means here)

- **Nessie**: self-hosted, Nessie-compatible mock (`src/nessie-mock`) on `http://localhost:4173`.
  The hosted API requires a student account, so none was created. Routes mirror the real Nessie
  shape (customers / accounts / purchases / transfers / deposits).
- **LLM compiler**: local **Ollama `llama3.1:8b`** (temperature 0, `format: json`) standing in for
  a hosted function-calling API. Free/local, no hosted key. This substitution is the single most
  important caveat: a frontier hosted model would very likely score higher on the compiler eval
  than the 8B local model measured below.
- **Ledger DB**: local PostgreSQL 16 on `localhost:5544` (Prisma).

Preconditions to reproduce: Postgres up on 5544, Ollama serving `llama3.1:8b`, then in the repo:
`npm install` → `npm run db:push` → `npm run mock:start` (separate shell) → the commands below.

---

## Phase 1: Nessie + seeding

**Command:** `npm run seed`
**Date:** 2026-08-03

- Seeded **500** synthetic customers, each with a Checking + Savings account and **6 months** of
  purchase history (date range 2026-02 → 2026-08), across 5 income/spend personas
  (`tight_budget`, `steady_saver`, `big_spender`, `gig_variable`, `high_earner`).
- Seeding completed in ~0.55 s (bulk inserts). Directory written to `data/directory.json`.
- Spot-check sample (printed by the script), e.g.:
  `Yesenia Waelchi [high_earner] income=$15259.19/mo purchases=132 range=2026-02-03..2026-08-03`.
- **Retry-on-5xx verify:** `test/nessie-client.test.ts` proves the client retries transient 503s
  and succeeds on the 3rd attempt, gives up after `maxRetries` with a `NessieApiError`, and does
  NOT retry non-retryable 4xx. (Part of `npm test`, below.)

## Phase 2: DSL + engine (+ ledger audit)

**Commands:** `npm test`, then `npm run ledger:batch` → `npm run audit`
**Date:** 2026-08-03

- **Test suite: 42/42 passing** (`vitest run`), 8 files. Includes:
  - `dsl-validator.test.ts` (15): adversarial DSL cases rejected: negative amounts, floor
    violations, cap-exceeding fixed transfers, `percent_of_deposit` on a non-deposit trigger,
    inverted amount ranges, missing fields.
  - `engine-idempotency.test.ts` (3, **integration**, real Postgres + real mock): replaying the
    same purchase 3× produces **1** ledger row (savings moved exactly once); balance-floor breach
    blocked; daily-cap breach blocked.
- **Idempotency at volume**: `npm run ledger:batch` drives the first **50** seeded customers'
  real purchase histories through the actual engine (real Postgres ledger + real Nessie mock
  transfers), then **replays the identical batch**:
  - Pass 1: **9,951** transfers executed; **105** blocked by the no-zero/negative-transfer rail
    (exact-dollar purchases whose round-up difference is $0).
  - Pass 2 (replay): **0** newly transferred, **9,951** duplicate-skipped.
  - Ledger rows after both passes: **9,951** (unchanged by the replay).
- **Ledger audit**: `npm run audit` over the resulting real ledger:
  - total transfers: **9,951**
  - with rule + triggering-transaction id: **9,951 (100.0%)**
  - fully traceable (referenced rule row exists): **9,951 (100.0%)**
  - distinct idempotency keys: **9,951** → **duplicate transfers: 0**

## Phase 3: NL compiler (Ollama llama3.1:8b)

**Command:** `npm run eval`  (writes `eval/results.json`)
**Date:** 2026-08-03

- **Exact-match on the 30-phrasing eval: 27/30 = 90.0%.**
- **Unsafe-rejection accuracy: 7/8 = 87.5%.**
- The 3 exact-match misses (real model errors, temp 0):
  1. "save $3 every time I stream something on a subscription service" → model categorized as
     `entertainment` instead of `subscriptions`.
  2. "save 5% of my paycheck each time I get paid" → model output `percent: 50` instead of `5`.
  3. "save $2 every time I watch a movie or go out for entertainment" → model added an extra
     `restaurants` category alongside `entertainment`.
- The 1 unsafe request not rejected: "buy me a coffee every morning", an unexpressible
  (not-a-savings-rule) request the guard + model let through as a preview rather than rejecting.
  The 7 genuinely dangerous ones (whole paycheck / entire balance / 100% / "all my money" /
  pay a third party / withdraw from savings / negative amount) were **all** correctly rejected
  with explanations; the deterministic `heuristicSafetyGuard` catches the money-unsafe class
  regardless of model behavior.

## Phase 4: Simulation + dashboard

**Command:** `npm run sim`  (writes `data/simulation-results.json`, `data/simulation-per-customer.json`)
**Date:** 2026-08-03

Replays all **500** customers over their seeded 6-month history against an assigned rule mix
(round-robin over 4 mixes, 125 customers each). Uses the *same* matching + safety-rail functions
as the live engine (in-memory, so it does not write 500×~175 ledger rows through Postgres; the
per-transfer ledger correctness is proven separately by Phase 2's real-ledger audit above).

- **Overall median savings: $69.38/mo** (p25 **$14.58**, p75 **$359.93**), across all 500 customers.
- Transfers executed (simulated): **54,744**; blocked by safety rails: **523**.
- Median monthly savings by rule mix:
  | rule mix | n | median $/mo |
  |---|---|---|
  | `flat_roundup` (round every purchase to nearest $1) | 125 | **$15.38** |
  | `coffee_fixed` ($3 per coffee) | 125 | **$14.00** |
  | `percent_deposit_10` (10% of each paycheck) | 125 | **$564.88** |
  | `combo_roundup_plus_deposit` (round-up + 5% of deposit) | 125 | **$283.94** |
- **Outperformance vs `flat_roundup` (median):** `percent_deposit_10` **+3,572% (36.7×)**;
  `combo_roundup_plus_deposit` **+1,746% (18.5×)**; `coffee_fixed` **−9% (0.9×)**.
  Caveat: the huge multipliers are structural. A percentage-of-paycheck rule moves far
  more money than nickel-and-dime round-ups by construction, not because of a subtle optimization.
  Per-persona breakdown in `data/simulation-results.json`.

**End-to-end demo**: `npm run demo` (real Ollama + Postgres + mock), 2026-08-03:
english rule "save $5 every time I order coffee" → compiled preview
(`fixed_transfer 500`, safety floor $25 / cap $25, projected impact shown) → activation
(persisted to Postgres) → a $4.30 coffee purchase → engine produced **exactly one** transfer of
**$5.00**, attributed `transfer → rule → triggering transaction`, savings balance $0 → $5.00.

---

## Summary of measured metrics

| Metric | Measured value | Source command |
|---|---|---|
| Compiler exact-match % (30 phrasings) | **90.0% (27/30)** | `npm run eval` |
| Unsafe-rejection accuracy | **87.5% (7/8)** | `npm run eval` |
| Simulated median savings / persona | overall **$69.38/mo**; per-mix table above | `npm run sim` |
| Transfers executed | **9,951** real ledger / **54,744** simulated | `npm run ledger:batch` / `npm run sim` |
| Duplicate transfers | **0** | `npm run audit` |
| Ledger audit: transfer → rule + triggering txn | **100.0% (9,951/9,951)** | `npm run audit` |

## Known imperfections

- Compiler is a local 8B model: 90% / 87.5%, not 100%. Three miscompiles and one
  missed unexpressible request are enumerated above and stored in `eval/results.json`.
- The 500-customer savings simulation is in-memory; the *real* Postgres+Nessie ledger integrity
  number (100% attribution, 0 duplicates) is measured on the 9,951-transfer batch, not on all
  54,744 simulated transfers.
- Rule-mix outperformance percentages are dominated by the deposit-percentage mechanism and
  should be read as "different savings magnitudes", not a tuned optimization.
