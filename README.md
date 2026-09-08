# RoundUps

A micro-savings service built on the Capital One Nessie mock-banking API. A customer
types a savings rule in plain English ("save $5 every time I order coffee"), a local
LLM turns it into a small zod-validated rules DSL, and an execution engine watches
purchases, fires transfers into savings, and writes every one to an append-only ledger
where each row points back at the rule and the exact transaction that triggered it.

The part I cared most about was making the money path boring. The model proposes the
shape of a rule; it never decides a safety number, and nothing it says gets activated
without a preview and an explicit confirm.

## How it works

The pipeline, top to bottom:

```
src/nessie-mock/     Nessie-compatible mock server
src/nessie-client/   HTTP client with capped-backoff retries on 429/5xx
src/dsl/             the rules DSL (zod): trigger, AND-ed conditions, action, safety block
src/engine/          match, compute amount, safety rails, idempotent transfer, ledger write
src/compiler/        heuristic guard, Ollama call, default safety numbers, impact preview
src/personas/        faker personas and 6-month purchase-history generator
src/sim/             rule mixes and the in-memory 500-customer simulation
app/                 Next.js 14 dashboard (accounts, rule add, goals, transfer history, sim charts)
prisma/              Rule, Transfer (append-only), Goal
```

A rule looks like this:

```jsonc
{
  "trigger":   { "type": "purchase" | "deposit" | "schedule" },
  "conditions": [
    { "type": "merchant_category", "categories": ["coffee"] },
    { "type": "amount_range", "maxCents": 5000 },
    { "type": "balance_floor", "minCents": 25000 }
  ],
  "action": { "type": "round_up", "toCents": 100 },            // or fixed_transfer / percent_of_deposit
  "safety": { "balanceFloorCents": 2500, "dailyCapCents": 3000 }  // always present, always enforced
}
```

Design decisions that ended up mattering:

- Money is integer cents everywhere. No floats touch the money path.
- The model owns "what", deterministic code owns "how safe". `src/compiler/defaults.ts`
  assigns the balance floor and daily cap, and `src/engine/safety.ts` re-checks every
  transfer at execution time, because balances change between when a rule is written and
  when it fires. Three independent layers: a pre-model heuristic guard, the model's own
  refusal path, and the zod validator plus runtime rails.
- Idempotency belongs to the engine, not the caller. The live purchase path, the batch
  runner, and any replay all go through `processPurchaseForRule`, keyed by
  `sha256(ruleId, triggeringTransactionId)`: app-level lookup, then the mock's own
  idempotency index, then a unique constraint on the ledger table.
- Preview before activation. `compilePlainEnglishRule` returns either a preview (with a
  projected monthly impact from the customer's real history) or a rejection with a
  reason. It never activates anything itself.

## Results

All of these come from runs on 2026-08-03; the exact commands and per-run detail are in
[RESULTS.md](./RESULTS.md).

| what | value |
|---|---|
| plain-English to DSL exact match (30 phrasings) | 27/30 (90.0%) |
| unsafe requests correctly rejected | 7/8 (87.5%) |
| real ledger transfers (50 customers through Postgres + mock) | 9,951 |
| transfers traceable to rule and triggering transaction | 100.0% |
| new rows after replaying the full batch | 0 |
| simulated customers, 6 months | 500 |
| overall median saved | $69.38/month |
| tests | 42/42 |

The three compiler misses are real model errors at temperature 0 (a `subscriptions`
phrase categorized as `entertainment`, "5% of my paycheck" compiled as `percent: 50`,
an extra `restaurants` category on an entertainment rule). The one unsafe request that
slipped through was "buy me a coffee every morning", which is not a savings rule rather
than a dangerous one; the seven genuinely dangerous ones (whole paycheck, entire
balance, pay a third party) were all caught, mostly by the deterministic guard before
the model saw them.

Median saved by rule mix: flat round-up $15.38, $3 per coffee $14.00, 10% of each
paycheck $564.88, round-up plus 5% of deposit $283.94. The paycheck numbers are large
by construction; a deposit rule simply moves more money than round-ups.

## Getting it running

You need Node 20 or newer, PostgreSQL reachable at the `DATABASE_URL` in `.env`
(default `localhost:5544`, database `roundups`), and [Ollama](https://ollama.com) with
`ollama pull llama3.1:8b`.

```bash
cp .env.example .env
npm install
npm run db:push
npm run mock:start        # Nessie-compatible mock on :4173, leave it running
```

In another shell:

```bash
npm run seed              # 500 customers, 6 months of history -> data/directory.json
npm test                  # 42 tests, including real-DB idempotency and adversarial DSL cases
npm run ledger:batch      # 50 customers' purchases through the engine, then a full replay
npm run audit             # attribution and duplicate check over the real ledger
npm run eval              # 30 phrasings + 8 unsafe requests -> eval/results.json
npm run sim               # 500-customer simulation -> data/simulation-*.json
npm run demo              # english rule -> preview -> activate -> one attributed transfer
npm run dev               # dashboard at http://localhost:3000
```

`eval`, `demo`, `ledger:batch`, and the idempotency tests hit the real mock, real
Postgres, and Ollama. Nothing under test is stubbed.

## Testing

Eight vitest files. `dsl-validator.test.ts` throws adversarial rules at the schema
(negative amounts, fixed transfers above the cap, `percent_of_deposit` on a purchase
trigger). `engine-idempotency.test.ts` runs against real Postgres and the mock:
replaying the same purchase three times leaves one ledger row. `nessie-client.test.ts`
checks that transient 503s are retried and 4xx errors are not.

## Caveats

- The hosted Nessie API needs a student account, so this runs against a self-hosted
  mock with the same routes; swap via `NESSIE_BASE_URL`.
- The compiler is `llama3.1:8b` running locally so the whole thing works offline with
  no API key. A larger hosted model would almost certainly do better on the eval.
- The 500-customer simulation is in-memory. It reuses the engine's matching and safety
  functions but does not write its 54,744 transfers through Postgres. The ledger
  integrity numbers come from the separate 9,951-transfer real batch.
- No real bank connections, real money, credit features, or mobile app.
