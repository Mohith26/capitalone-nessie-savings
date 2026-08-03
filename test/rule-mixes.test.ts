import { describe, expect, it } from "vitest";
import { RULE_MIXES } from "../src/sim/rule-mixes";
import { validateRuleDsl } from "../src/dsl/schema";

describe("RULE_MIXES", () => {
  it("every rule in every simulation mix passes the same zod validator the compiler uses", () => {
    for (const mix of RULE_MIXES) {
      for (const rule of mix.rules) {
        const result = validateRuleDsl(rule);
        expect(result.ok, `${mix.name} rule failed validation: ${result.errors?.join("; ")}`).toBe(true);
      }
    }
  });
});
