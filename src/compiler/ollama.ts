import { z } from "zod";
import { ActionSchema, ConditionSchema, TriggerSchema } from "../dsl/schema";

const SYSTEM_PROMPT = `You translate a bank customer's plain-English savings request into a strict JSON rule.

The JSON you output has this shape:
{
  "rejected": false,
  "trigger": <Trigger>,
  "conditions": <Condition[]>,
  "action": <Action>,
  "explanation": "<one short sentence describing what the rule does>"
}
or, if the request cannot be expressed safely or doesn't describe a savings rule:
{ "rejected": true, "reason": "<one short sentence explaining why>" }

Trigger is exactly one of:
  {"type":"purchase"}
  {"type":"deposit"}
  {"type":"schedule","weekday":0-6}   // 0=Sunday..6=Saturday

Condition is zero or more of:
  {"type":"merchant_category","categories":["coffee"|"groceries"|"restaurants"|"rideshare"|"entertainment"|"utilities"|"rent"|"shopping"|"subscriptions"|"gas"]}
  {"type":"amount_range","minCents":<int>,"maxCents":<int>}
  {"type":"balance_floor","minCents":<int>}

Action is exactly one of:
  {"type":"round_up","toCents":100|500|1000}          // round purchase up to nearest $1/$5/$10
  {"type":"fixed_transfer","amountCents":<positive int>}
  {"type":"percent_of_deposit","percent":<0-100>}       // ONLY valid with trigger "deposit"

Rules:
- round_up and fixed_transfer require trigger "purchase" (or "schedule" for fixed_transfer on a cadence).
- percent_of_deposit requires trigger "deposit".
- All dollar amounts in the user's text must be converted to integer cents (e.g. "$5" -> 500).
- Reject anything that would move an entire paycheck/balance/"everything" with no bound, anything that isn't a
  savings-into-this-account action, or anything you cannot map to the schema above.
- Output ONLY the JSON object. No prose, no markdown fences.

Examples:
User: "save $5 every time I order coffee"
{"rejected":false,"trigger":{"type":"purchase"},"conditions":[{"type":"merchant_category","categories":["coffee"]}],"action":{"type":"fixed_transfer","amountCents":500},"explanation":"Transfers $5 to savings every coffee purchase."}

User: "round up every purchase to the nearest dollar"
{"rejected":false,"trigger":{"type":"purchase"},"conditions":[],"action":{"type":"round_up","toCents":100},"explanation":"Rounds every purchase up to the nearest dollar and saves the difference."}

User: "save 10% of every paycheck"
{"rejected":false,"trigger":{"type":"deposit"},"conditions":[],"action":{"type":"percent_of_deposit","percent":10},"explanation":"Saves 10% of every deposit."}

User: "save my whole paycheck every month"
{"rejected":true,"reason":"Moving an entire paycheck has no safe bound; try a percentage or fixed amount instead."}
`;

const ProposalSchema = z.union([
  z.object({
    rejected: z.literal(false),
    trigger: TriggerSchema,
    conditions: z.array(ConditionSchema).default([]),
    action: ActionSchema,
    explanation: z.string(),
  }),
  z.object({
    rejected: z.literal(true),
    reason: z.string(),
  }),
]);
export type Proposal = z.infer<typeof ProposalSchema>;

export interface OllamaOptions {
  baseUrl?: string;
  model?: string;
  fetchImpl?: typeof fetch;
}

export class CompilerModelError extends Error {}

/**
 * Calls the local Ollama server (free/local -- no hosted LLM account, see
 * PLAN.md/README for why this substitutes for the spec's "Claude/GPT function
 * calling") and parses its JSON response into a Proposal. Retries once with a
 * stricter reminder if the first response fails to parse -- small local models are
 * less reliable at strict JSON than a hosted frontier model, so one retry buys back
 * most of that gap without hiding failures.
 */
export async function proposeRuleFromText(text: string, opts: OllamaOptions = {}): Promise<Proposal> {
  const baseUrl = opts.baseUrl ?? process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
  const model = opts.model ?? process.env.OLLAMA_MODEL ?? "llama3.1:8b";
  const fetchImpl = opts.fetchImpl ?? fetch;

  const attempt = async (reminder?: string): Promise<Proposal> => {
    const userContent = reminder ? `${text}\n\n(${reminder})` : text;
    const res = await fetchImpl(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        format: "json",
        options: { temperature: 0 },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
      }),
    });
    if (!res.ok) {
      throw new CompilerModelError(`Ollama request failed: ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as { message?: { content?: string } };
    const raw = body.message?.content ?? "";
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      throw new CompilerModelError(`Model did not return valid JSON: ${raw.slice(0, 200)}`);
    }
    const result = ProposalSchema.safeParse(parsedJson);
    if (!result.success) {
      throw new CompilerModelError(`Model JSON did not match the rule schema: ${result.error.message}`);
    }
    return result.data;
  };

  try {
    return await attempt();
  } catch (firstErr) {
    try {
      return await attempt("Respond with ONLY the JSON object exactly matching the schema, nothing else.");
    } catch (secondErr) {
      throw secondErr instanceof CompilerModelError ? secondErr : (firstErr as Error);
    }
  }
}
