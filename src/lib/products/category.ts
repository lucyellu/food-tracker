// Item categorization shared across the parser, persistence, and UI.
// The LLM assigns a category per item going forward; categorizeItem() is the
// keyword heuristic used to backfill existing data and as a fallback when the
// model omits a category.

export const CATEGORIES = [
  "food",
  "drink",
  "cannabis",
  "supplement",
  "household",
  "personal_care",
  "other",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  food: "Food",
  drink: "Drink",
  cannabis: "Cannabis",
  supplement: "Supplement",
  household: "Household",
  personal_care: "Personal care",
  other: "Other",
};

// Consumables are subject to the auto consumption window (next same-vendor
// purchase or 7 days, whichever is sooner).
export const CONSUMABLE_CATEGORIES = new Set<Category>([
  "food",
  "drink",
  "cannabis",
  "supplement",
]);

export function isCategory(value: unknown): value is Category {
  return typeof value === "string" && (CATEGORIES as readonly string[]).includes(value);
}

export function isConsumableCategory(value: unknown): boolean {
  return isCategory(value) && CONSUMABLE_CATEGORIES.has(value);
}

// Ordered keyword rules. First match wins, so more specific buckets
// (cannabis, supplement, drink) are checked before the generic ones.
const RULES: Array<{ category: Category; pattern: RegExp }> = [
  {
    category: "supplement",
    pattern:
      /\b(vitamin|multivitamin|supplement|probiotic|omega[\s-]?3|fish oil|collagen|magnesium|melatonin|creatine|protein powder|electrolyte|capsule|softgel|gummies?|mcg|iu)\b/i,
  },
  {
    category: "drink",
    pattern:
      /\b(water|sparkling|soda|pop|cola|juice|lemonade|milk|almond milk|oat milk|soy milk|coffee|espresso|latte|tea|matcha|kombucha|smoothie|beer|lager|ale|ipa|wine|cider|seltzer|cocktail|gatorade|powerade|energy drink|red bull|drink|beverage|nectar)\b/i,
  },
  {
    category: "personal_care",
    pattern:
      /\b(shampoo|conditioner|toothpaste|toothbrush|deodorant|lotion|moisturizer|sunscreen|razor|shaving|soap bar|body wash|face wash|cosmetic|makeup|lipstick|mascara|tampon|pad|floss|mouthwash)\b/i,
  },
  {
    category: "household",
    pattern:
      /\b(detergent|laundry|dish soap|dishwasher|cleaner|bleach|disinfectant|paper towel|toilet paper|tissue|napkin|garbage bag|trash bag|ziploc|foil|aluminum|plastic wrap|sponge|broom|battery|batteries|light bulb|candle|air freshener|fabric softener)\b/i,
  },
];

export function categorizeItem({
  rawName,
  unit,
  hasActiveIngredients = false,
}: {
  rawName: string;
  unit?: string | null;
  hasActiveIngredients?: boolean;
}): Category {
  if (hasActiveIngredients) return "cannabis";

  const name = rawName?.trim() ?? "";
  if (!name) return "other";

  for (const rule of RULES) {
    if (rule.pattern.test(name)) return rule.category;
  }

  // Liquid units strongly imply a drink even without a keyword match.
  const liquidUnit = unit ? /^(ml|l|fl_oz|cup|pt|qt|gal)$/i.test(unit) : false;
  if (liquidUnit) return "drink";

  // Default groceries to food; truly unknown short tokens fall through to other.
  return name.length >= 3 ? "food" : "other";
}
