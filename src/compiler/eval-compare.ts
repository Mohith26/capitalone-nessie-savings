import type { Action, Condition, Trigger } from "../dsl/schema";

export interface ExpectedShape {
  trigger: Trigger;
  conditions: Condition[];
  action: Action;
}

/** Deep-equality that ignores object key order and condition/category array order. */
export function matchesExpectedShape(actual: ExpectedShape, expected: ExpectedShape): boolean {
  return (
    deepEqualSorted(actual.trigger) === deepEqualSorted(expected.trigger) &&
    JSON.stringify(canonicalizeConditions(actual.conditions)) ===
      JSON.stringify(canonicalizeConditions(expected.conditions)) &&
    deepEqualSorted(actual.action) === deepEqualSorted(expected.action)
  );
}

function canonicalizeConditions(conditions: Condition[]): string[] {
  return conditions
    .map((c) => {
      if (c.type === "merchant_category") {
        return JSON.stringify({ type: c.type, categories: [...c.categories].sort() });
      }
      return deepEqualSorted(c);
    })
    .sort();
}

/** Stringify an object with its keys sorted, so key order never affects comparison. */
function deepEqualSorted(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, sortKeysDeep(v)]),
    );
  }
  return value;
}
