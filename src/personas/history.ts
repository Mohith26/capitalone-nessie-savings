import { faker } from "@faker-js/faker";
import { weightedCategory, type PersonaProfile } from "./personas";

export interface GeneratedPurchase {
  merchant_id: string;
  merchant_name: string;
  merchant_category: string;
  purchase_date: string; // ISO date (date-only)
  amount: number; // cents, positive
}

const MERCHANT_NAMES: Record<string, string[]> = {
  coffee: ["Blue Bottle Coffee", "Corner Cafe", "Daily Grind"],
  groceries: ["Fresh Market", "Neighborhood Grocer", "Corner Pantry"],
  restaurants: ["Taco Spot", "Ramen House", "Green Bowl"],
  rideshare: ["CityRide", "QuickCab"],
  entertainment: ["Cineplex", "Arcade Bar"],
  utilities: ["City Power & Water", "Metro Utilities"],
  rent: ["Parkview Apartments"],
  shopping: ["Downtown Outfitters", "Home Goods Co"],
  subscriptions: ["StreamPlus", "MusicWave"],
  gas: ["QuickFuel", "Highway Gas & Go"],
};

function merchantNameFor(category: string): string {
  const options = MERCHANT_NAMES[category] ?? ["General Merchant"];
  return faker.helpers.arrayElement(options);
}

/**
 * Generate `months` worth of purchase history for one persona, evenly spread across
 * the window ending at `endDate` (defaults to today). Amounts are drawn from the
 * persona's amount range; recurring categories (rent/utilities/subscriptions) are
 * forced to appear once per month like a real recurring bill.
 */
export function generatePurchaseHistory(
  profile: PersonaProfile,
  months = 6,
  endDate: Date = new Date(),
): GeneratedPurchase[] {
  const purchases: GeneratedPurchase[] = [];
  const start = new Date(endDate);
  start.setMonth(start.getMonth() - months);

  for (let m = 0; m < months; m += 1) {
    const monthStart = new Date(start);
    monthStart.setMonth(start.getMonth() + m);
    const monthEnd = new Date(start);
    monthEnd.setMonth(start.getMonth() + m + 1);

    // Recurring monthly bills, once each, if the persona's category weights include them.
    for (const recurring of ["rent", "utilities", "subscriptions"] as const) {
      if (profile.categoryWeights[recurring] > 0) {
        const date = faker.date.between({ from: monthStart, to: monthEnd });
        const amount =
          recurring === "rent"
            ? faker.number.int({ min: 90000, max: 220000 })
            : recurring === "utilities"
              ? faker.number.int({ min: 4000, max: 18000 })
              : faker.number.int({ min: 500, max: 6000 });
        purchases.push({
          merchant_id: `mer_${recurring}`,
          merchant_name: merchantNameFor(recurring),
          merchant_category: recurring,
          purchase_date: date.toISOString().slice(0, 10),
          amount,
        });
      }
    }

    const discretionaryCount = profile.purchasesPerMonth - 3;
    for (let i = 0; i < discretionaryCount; i += 1) {
      const category = weightedCategory(
        Object.fromEntries(
          Object.entries(profile.categoryWeights).filter(
            ([c]) => !["rent", "utilities", "subscriptions"].includes(c),
          ),
        ),
      );
      const date = faker.date.between({ from: monthStart, to: monthEnd });
      const [min, max] = profile.amountRangeCents;
      const amount = faker.number.int({ min, max });
      purchases.push({
        merchant_id: `mer_${category}`,
        merchant_name: merchantNameFor(category),
        merchant_category: category,
        purchase_date: date.toISOString().slice(0, 10),
        amount,
      });
    }
  }

  purchases.sort((a, b) => a.purchase_date.localeCompare(b.purchase_date));
  return purchases;
}
