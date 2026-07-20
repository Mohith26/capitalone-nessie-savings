import { faker } from "@faker-js/faker";

export type PersonaKind = "tight_budget" | "steady_saver" | "big_spender" | "gig_variable" | "high_earner";

export interface PersonaProfile {
  kind: PersonaKind;
  monthlyIncomeCents: number;
  startingCheckingCents: number;
  startingSavingsCents: number;
  // number of purchases per month, and the merchant-category weights used to pick them
  purchasesPerMonth: number;
  categoryWeights: Record<string, number>;
  amountRangeCents: [number, number];
}

export const MERCHANT_CATEGORIES = [
  "coffee",
  "groceries",
  "restaurants",
  "rideshare",
  "entertainment",
  "utilities",
  "rent",
  "shopping",
  "subscriptions",
  "gas",
] as const;

const PERSONA_KINDS: PersonaKind[] = [
  "tight_budget",
  "steady_saver",
  "big_spender",
  "gig_variable",
  "high_earner",
];

/** Deterministic-ish persona weighting: every kind is represented, roughly evenly. */
export function personaKindForIndex(index: number): PersonaKind {
  return PERSONA_KINDS[index % PERSONA_KINDS.length];
}

export function buildPersonaProfile(kind: PersonaKind): PersonaProfile {
  switch (kind) {
    case "tight_budget":
      return {
        kind,
        monthlyIncomeCents: faker.number.int({ min: 210000, max: 320000 }), // $2.1k-3.2k
        startingCheckingCents: faker.number.int({ min: 15000, max: 60000 }),
        startingSavingsCents: faker.number.int({ min: 0, max: 20000 }),
        purchasesPerMonth: faker.number.int({ min: 28, max: 42 }),
        categoryWeights: {
          coffee: 6,
          groceries: 8,
          restaurants: 4,
          rideshare: 2,
          entertainment: 1,
          utilities: 1,
          rent: 1,
          shopping: 3,
          subscriptions: 2,
          gas: 4,
        },
        amountRangeCents: [300, 6000],
      };
    case "steady_saver":
      return {
        kind,
        monthlyIncomeCents: faker.number.int({ min: 400000, max: 650000 }),
        startingCheckingCents: faker.number.int({ min: 200000, max: 500000 }),
        startingSavingsCents: faker.number.int({ min: 100000, max: 400000 }),
        purchasesPerMonth: faker.number.int({ min: 20, max: 32 }),
        categoryWeights: {
          coffee: 5,
          groceries: 8,
          restaurants: 4,
          rideshare: 2,
          entertainment: 2,
          utilities: 1,
          rent: 1,
          shopping: 3,
          subscriptions: 3,
          gas: 3,
        },
        amountRangeCents: [400, 9000],
      };
    case "big_spender":
      return {
        kind,
        monthlyIncomeCents: faker.number.int({ min: 550000, max: 900000 }),
        startingCheckingCents: faker.number.int({ min: 150000, max: 400000 }),
        startingSavingsCents: faker.number.int({ min: 0, max: 150000 }),
        purchasesPerMonth: faker.number.int({ min: 40, max: 60 }),
        categoryWeights: {
          coffee: 8,
          groceries: 6,
          restaurants: 10,
          rideshare: 6,
          entertainment: 6,
          utilities: 1,
          rent: 1,
          shopping: 9,
          subscriptions: 4,
          gas: 3,
        },
        amountRangeCents: [500, 25000],
      };
    case "gig_variable":
      return {
        kind,
        monthlyIncomeCents: faker.number.int({ min: 180000, max: 550000 }), // variable/lower avg
        startingCheckingCents: faker.number.int({ min: 5000, max: 80000 }),
        startingSavingsCents: faker.number.int({ min: 0, max: 15000 }),
        purchasesPerMonth: faker.number.int({ min: 22, max: 38 }),
        categoryWeights: {
          coffee: 4,
          groceries: 7,
          restaurants: 5,
          rideshare: 5,
          entertainment: 2,
          utilities: 1,
          rent: 1,
          shopping: 4,
          subscriptions: 2,
          gas: 6,
        },
        amountRangeCents: [300, 8000],
      };
    case "high_earner":
      return {
        kind,
        monthlyIncomeCents: faker.number.int({ min: 900000, max: 1600000 }),
        startingCheckingCents: faker.number.int({ min: 500000, max: 1200000 }),
        startingSavingsCents: faker.number.int({ min: 300000, max: 1500000 }),
        purchasesPerMonth: faker.number.int({ min: 18, max: 30 }),
        categoryWeights: {
          coffee: 4,
          groceries: 5,
          restaurants: 8,
          rideshare: 3,
          entertainment: 4,
          utilities: 1,
          rent: 1,
          shopping: 6,
          subscriptions: 4,
          gas: 2,
        },
        amountRangeCents: [800, 40000],
      };
  }
}

export function weightedCategory(weights: Record<string, number>): string {
  const entries = Object.entries(weights);
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let roll = faker.number.float({ min: 0, max: total });
  for (const [category, weight] of entries) {
    if (roll < weight) return category;
    roll -= weight;
  }
  return entries[entries.length - 1][0];
}
