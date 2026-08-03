import { validateRuleDsl, type RuleDsl } from "../dsl/schema";
import { defaultDailyCapCentsForAction, DEFAULT_BALANCE_FLOOR_CENTS } from "./defaults";
import { projectMonthlyImpactCents, type ImpactHistoryContext } from "./impact";
import { proposeRuleFromText, type OllamaOptions } from "./ollama";
import { heuristicSafetyGuard } from "./safety-guard";

export type CompileOutcome =
  | {
      status: "preview";
      dsl: RuleDsl;
      explanation: string;
      projectedMonthlyImpactCents: number;
    }
  | {
      status: "rejected";
      reason: string;
    };

/**
 * Full plain-English -> DSL pipeline:
 *   1. heuristic safety guard (deterministic, pre-model)
 *   2. model proposal (Ollama; may itself reject)
 *   3. deterministic safety-rail defaults applied to the proposal
 *   4. zod validation of the fully-assembled rule
 *   5. deterministic monthly-impact projection from real history
 * A rule is NEVER activated by this function -- it only ever returns a preview that
 * a human (or the e2e demo script) must separately confirm, per the spec's
 * preview-before-activation requirement.
 */
export async function compilePlainEnglishRule(
  text: string,
  history: ImpactHistoryContext,
  ollamaOpts: OllamaOptions = {},
): Promise<CompileOutcome> {
  const guard = heuristicSafetyGuard(text);
  if (guard.blocked) {
    return { status: "rejected", reason: guard.reason! };
  }

  const proposal = await proposeRuleFromText(text, ollamaOpts);
  if (proposal.rejected) {
    return { status: "rejected", reason: proposal.reason };
  }

  const candidate = {
    trigger: proposal.trigger,
    conditions: proposal.conditions,
    action: proposal.action,
    safety: {
      balanceFloorCents: DEFAULT_BALANCE_FLOOR_CENTS,
      dailyCapCents: defaultDailyCapCentsForAction(proposal.action),
    },
  };

  const validated = validateRuleDsl(candidate);
  if (!validated.ok) {
    return {
      status: "rejected",
      reason: `The model's proposal did not satisfy the rules DSL's safety constraints: ${validated.errors?.join("; ")}`,
    };
  }

  const projectedMonthlyImpactCents = projectMonthlyImpactCents(validated.rule!, history);

  return {
    status: "preview",
    dsl: validated.rule!,
    explanation: proposal.explanation,
    projectedMonthlyImpactCents,
  };
}
