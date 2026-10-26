// Passive pantry model: assume what you bought is what you're eating, and
// estimate how much of each food is left from how long it usually lasts you.

export type FoodKind =
  | "produce"
  | "protein"
  | "dairy"
  | "bakery"
  | "prepared"
  | "frozen"
  | "pantry"
  | "snack"
  | "drink"
  | "condiment"
  | "spice"
  | "non_food";

export type PantryFood = {
  id: number;
  slug: string;
  name: string;
  emoji: string | null;
  kind: FoodKind;
  shelfLifeDays: number;
  typicalFinishDays: number;
  imageUrl: string | null;
};

export type Purchase = {
  date: string; // YYYY-MM-DD
  lineItemId: number;
  receiptId: number;
  vendor: string | null;
  productName: string;
  quantity: number;
  unit: string;
  price: number | null;
};

export type FoodHistory = {
  food: PantryFood;
  purchases: Purchase[]; // ascending by date
};

export type Lifetime = {
  days: number;
  // "learned" once there are enough repurchases to trust the interval.
  basis: "learned" | "typical";
  medianGapDays: number | null;
};

export type PantryLevel = "full" | "half" | "low" | "out";

export type PantryEntry = {
  food: PantryFood;
  lastBought: string;
  daysSince: number;
  lifetime: Lifetime;
  remaining: number; // 0..1
  daysLeft: number;
  level: PantryLevel;
  buyCount: number;
  // Bought regularly and due (or overdue) for a rebuy.
  rebuySoon: boolean;
  lastPurchases: Purchase[]; // purchases on the last-bought date
};

export type Zone = "fridge" | "freezer" | "cupboard" | "spices";

export const ZONES: { key: Zone; label: string; note: string }[] = [
  { key: "fridge", label: "Fridge", note: "Fresh things, eaten first" },
  { key: "cupboard", label: "Cupboard", note: "Staples, snacks & drinks" },
  { key: "spices", label: "Sauces & spices", note: "Slow to finish, learned from rebuys" },
  { key: "freezer", label: "Freezer", note: "Keeps for a while" },
];

const ZONE_BY_KIND: Record<FoodKind, Zone | null> = {
  produce: "fridge",
  protein: "fridge",
  dairy: "fridge",
  prepared: "fridge",
  bakery: "cupboard",
  pantry: "cupboard",
  snack: "cupboard",
  drink: "cupboard",
  condiment: "spices",
  spice: "spices",
  frozen: "freezer",
  non_food: null,
};

export function zoneForKind(kind: FoodKind): Zone | null {
  return ZONE_BY_KIND[kind];
}

const DAY_MS = 86_400_000;
const MIN_GAPS_TO_LEARN = 2;
// Only foods bought within this window count as on hand, however slowly they finish.
export const ON_HAND_WINDOW_DAYS = 14;

export function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function uniqueDates(purchases: Purchase[]) {
  return [...new Set(purchases.map((p) => p.date))].sort();
}

/**
 * How long one purchase of this food lasts. The repurchase interval is the best
 * signal for slow foods (a soy sauce rebought every ~60 days lasts ~60 days),
 * but fresh food spoils before the next shop, so shelf life caps it.
 */
export function learnLifetime(food: PantryFood, purchases: Purchase[]): Lifetime {
  const dates = uniqueDates(purchases);
  const gaps = dates.slice(1).map((d, i) => daysBetween(dates[i], d)).filter((g) => g > 0);
  const shelf = Math.max(1, food.shelfLifeDays);

  if (gaps.length >= MIN_GAPS_TO_LEARN) {
    const gap = median(gaps);
    return { days: Math.max(1, Math.min(Math.round(gap), shelf)), basis: "learned", medianGapDays: gap };
  }
  return {
    days: Math.max(1, Math.min(food.typicalFinishDays, shelf)),
    basis: "typical",
    medianGapDays: gaps.length ? gaps[0] : null,
  };
}

function levelFor(remaining: number): PantryLevel {
  if (remaining <= 0) return "out";
  if (remaining < 0.25) return "low";
  if (remaining < 0.66) return "half";
  return "full";
}

const SLOW_KINDS = new Set<FoodKind>(["condiment", "spice", "pantry", "drink", "snack", "frozen"]);

export function pantryEntry(history: FoodHistory, asOf: string): PantryEntry | null {
  const past = history.purchases.filter((p) => p.date <= asOf);
  if (past.length === 0) return null;

  const lastBought = past[past.length - 1].date;
  const lifetime = learnLifetime(history.food, past);
  const daysSince = daysBetween(lastBought, asOf);
  const remaining = Math.max(0, Math.min(1, 1 - daysSince / lifetime.days));
  const buyCount = uniqueDates(past).length;
  const rebuyAt = lifetime.medianGapDays ?? lifetime.days;

  return {
    food: history.food,
    lastBought,
    daysSince,
    lifetime,
    remaining,
    daysLeft: Math.max(0, lifetime.days - daysSince),
    level: levelFor(remaining),
    buyCount,
    rebuySoon:
      lifetime.basis === "learned" &&
      SLOW_KINDS.has(history.food.kind) &&
      daysSince >= rebuyAt * 0.9 &&
      daysSince <= rebuyAt * 1.3,
    lastPurchases: past.filter((p) => p.date === lastBought),
  };
}

export type PantrySnapshot = {
  asOf: string;
  zones: { key: Zone; label: string; note: string; entries: PantryEntry[] }[];
  inStock: number;
  runningLow: PantryEntry[];
};

export function pantrySnapshot(histories: FoodHistory[], asOf: string): PantrySnapshot {
  const entries = histories
    .map((h) => pantryEntry(h, asOf))
    .filter((e): e is PantryEntry => e !== null && zoneForKind(e.food.kind) !== null);

  const stocked = entries.filter((e) => e.remaining > 0 && e.daysSince <= ON_HAND_WINDOW_DAYS);
  const zones = ZONES.map((zone) => ({
    ...zone,
    entries: stocked
      .filter((e) => zoneForKind(e.food.kind) === zone.key)
      .sort((a, b) => b.remaining - a.remaining || a.food.name.localeCompare(b.food.name)),
  }));

  const runningLow = entries
    .filter((e) => e.rebuySoon || (e.level === "low" && e.lifetime.basis === "learned" && e.buyCount >= 4))
    .sort((a, b) => a.remaining - b.remaining || b.buyCount - a.buyCount);

  return { asOf, zones, inStock: stocked.length, runningLow };
}
