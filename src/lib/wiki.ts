import { unstable_cache } from "next/cache";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { FOOD_DATA_CACHE_SECONDS, FOOD_DATA_CACHE_TAG } from "@/lib/food-data-cache";

const WIKI_CACHE_VERSION = "wiki-classifier-v4";

export type WikiKind = "product" | "brand" | "ingredient" | "nutrient" | "category" | "strain" | "bottle";

export const WIKI_KINDS: Array<{ key: WikiKind; label: string; plural: string }> = [
  { key: "product", label: "Product", plural: "Products" },
  { key: "brand", label: "Brand", plural: "Brands" },
  { key: "ingredient", label: "Ingredient", plural: "Ingredients" },
  { key: "nutrient", label: "Nutrient", plural: "Nutrients" },
  { key: "category", label: "Category", plural: "Categories" },
  { key: "strain", label: "Strain", plural: "Strains" },
  { key: "bottle", label: "Bottle", plural: "Bottles" },
];

export type WikiNutrition = {
  totalGrams: number | null;
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  fiberG: number | null;
  sugarG: number | null;
  sodiumMg: number | null;
  alcoholG: number | null;
  caffeineMg: number | null;
  thcMg: number | null;
  cbdMg: number | null;
};

export type WikiOccurrence = {
  receiptId: number;
  rawName: string;
  vendor: string | null;
  purchasedAt: string | null;
  price: number | null;
};

export type WikiEntry = {
  kind: WikiKind;
  slug: string;
  href: string;
  title: string;
  subtitle: string;
  summary: string;
  count: number;
  totalSpend: number;
  latestDate: string | null;
  imageUrl: string | null;
  nutrition: WikiNutrition;
  related: Array<{ kind: WikiKind; title: string; href: string }>;
  occurrences: WikiOccurrence[];
};

export type WikiIndexEntry = Pick<
  WikiEntry,
  "kind" | "slug" | "href" | "title" | "subtitle" | "summary" | "count" | "totalSpend" | "imageUrl"
>;

type WikiSourceRow = {
  lineItemId: number;
  receiptId: number;
  rawName: string;
  normalizedName: string | null;
  itemCategory: string | null;
  itemBrand: string | null;
  price: number | null;
  productId: number | null;
  productName: string | null;
  productCategory: string | null;
  productBrand: string | null;
  productImageUrl: string | null;
  vendor: string | null;
  purchasedAt: string | null;
  totalGrams: number | null;
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  fiberG: number | null;
  sugarG: number | null;
  sodiumMg: number | null;
  alcoholG: number | null;
  caffeineMg: number | null;
  ingredientsText: string | null;
  activeIngredientsJson: string | null;
};

type NutritionAccumulator = {
  [K in keyof WikiNutrition]: { total: number; count: number };
};

type EntryAccumulator = {
  kind: WikiKind;
  slug: string;
  title: string;
  subtitle: string;
  imageUrl: string | null;
  rows: WikiSourceRow[];
  nutrition: NutritionAccumulator;
};

const NUTRIENTS: Array<{
  slug: string;
  title: string;
  subtitle: string;
  key: keyof WikiNutrition;
  unit: string;
}> = [
  { slug: "calories", title: "Calories", subtitle: "Energy", key: "calories", unit: "kcal" },
  { slug: "protein", title: "Protein", subtitle: "Macronutrient", key: "proteinG", unit: "g" },
  { slug: "carbohydrates", title: "Carbohydrates", subtitle: "Macronutrient", key: "carbsG", unit: "g" },
  { slug: "fat", title: "Fat", subtitle: "Macronutrient", key: "fatG", unit: "g" },
  { slug: "fiber", title: "Fiber", subtitle: "Carbohydrate detail", key: "fiberG", unit: "g" },
  { slug: "sugar", title: "Sugar", subtitle: "Carbohydrate detail", key: "sugarG", unit: "g" },
  { slug: "sodium", title: "Sodium", subtitle: "Mineral", key: "sodiumMg", unit: "mg" },
  { slug: "alcohol", title: "Alcohol", subtitle: "Active intake", key: "alcoholG", unit: "g" },
  { slug: "caffeine", title: "Caffeine", subtitle: "Active intake", key: "caffeineMg", unit: "mg" },
  { slug: "thc", title: "THC", subtitle: "Cannabis active", key: "thcMg", unit: "mg" },
  { slug: "cbd", title: "CBD", subtitle: "Cannabis active", key: "cbdMg", unit: "mg" },
];

const CANNABIS_SIGNAL_RE =
  /\b(thc|cbd|cbn|cbg|flower|pre[-\s]?roll|preroll|indica|sativa|hybrid|rosin|hash|vape|cart|edible|gumm(?:y|ies)|joint|dutch\s*love)\b/i;
const CANNABIS_STRONG_SIGNAL_RE =
  /\b(thc|cbd|cbn|cbg|cannabinoid|terpene|cannabis|marijuana|pre[-\s]?roll|preroll|indica|sativa|hybrid|rosin|hash|vape|cart|edible|gumm(?:y|ies)|joint|dutch\s*love)\b/i;
const CANNABIS_VENDOR_RE = /\b(dutch\s*love|la\s*canapa|dispensary|cannabis|weed\s*me|pure\s*sunfarms)\b/i;
const CANNABIS_FOOD_CONTEXT_RE =
  /\b(cilantro|parsley|basil|mint|dill|thyme|rosemary|oregano|chive|scallion|lettuce|spinach|broccoli|cauliflower|shrimp|prawn|seafood|fish|chicken|beef|pork|tofu|sauce|spice|seasoning|mustard|tea|coffee)\b/i;
const ALCOHOL_SIGNAL_RE =
  /\b(wine|beer|cider|vodka|gin|rum|whisk(?:y|ey)|tequila|liqueur|lager|ipa|merlot|pinot|cabernet|chardonnay|riesling|malbec|syrah|sauvignon|bordeaux|rioja)\b/i;
const AMBIGUOUS_ALCOHOL_SIGNAL_RE = /\b(ale|cocktail|cooler|seltzer)\b/i;
const ALCOHOL_VENDOR_RE = /\b(liquor|wine|beer|spirits|bottle\s*depot)\b/i;
const ALCOHOL_STRENGTH_RE = /\b(?:abv|alc(?:ohol)?(?:\s*\/\s*vol)?|% alc|alc\.?)\b/i;
const ALCOHOL_FOOD_CONTEXT_RE =
  /\b(cooking\s*wine|rice\s*wine|shaoxing|huangjiu|mei\s*kuei\s*lu|wine\s*vinegar|vinegar|wine\s*sauce|vodka\s*sauce|beer\s*mustard|ginger\s*ale|tomato\s*cocktail|clamato|mocktail|non[-\s]?alcoholic)\b/i;

const EMPTY_NUTRITION: WikiNutrition = {
  totalGrams: null,
  calories: null,
  proteinG: null,
  carbsG: null,
  fatG: null,
  fiberG: null,
  sugarG: null,
  sodiumMg: null,
  alcoholG: null,
  caffeineMg: null,
  thcMg: null,
  cbdMg: null,
};

export function isWikiKind(value: string): value is WikiKind {
  return WIKI_KINDS.some((kind) => kind.key === value);
}

export function wikiKindLabel(kind: WikiKind) {
  return WIKI_KINDS.find((item) => item.key === kind)?.label ?? "Entry";
}

export function wikiKindPlural(kind: WikiKind) {
  return WIKI_KINDS.find((item) => item.key === kind)?.plural ?? "Entries";
}

export function slugify(value: string) {
  const slug = value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  return slug || "entry";
}

export function formatWikiMoney(value: number) {
  return `$${value.toFixed(value >= 100 ? 0 : 2)}`;
}

export function formatWikiNumber(value: number | null, unit = "") {
  if (value == null || !Number.isFinite(value)) return "0";
  const formatted = value >= 100 ? Math.round(value).toLocaleString() : value.toLocaleString(undefined, {
    maximumFractionDigits: value >= 10 ? 1 : 2,
  });
  return unit ? `${formatted}${unit}` : formatted;
}

function cleanName(value: string | null | undefined) {
  return (value ?? "")
    .replace(/\s+/g, " ")
    .replace(/[|]+/g, " ")
    .trim();
}

function titleCase(value: string) {
  return value
    .split(/\s+/)
    .map((part) => {
      if (/^[A-Z0-9&-]+$/.test(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(" ");
}

function finite(value: number | null | undefined) {
  return Number.isFinite(value) ? Number(value) : null;
}

function parseActiveIngredients(value: string | null) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as { active?: Record<string, unknown> } & Record<string, unknown>;
    const active = parsed.active && typeof parsed.active === "object" ? parsed.active : parsed;
    return {
      thcMg: finite(Number(active.thcMg ?? active.totalThcMg)),
      cbdMg: finite(Number(active.cbdMg ?? active.totalCbdMg)),
    };
  } catch {
    return {};
  }
}

function nutritionFromRow(row: WikiSourceRow): WikiNutrition {
  const active = parseActiveIngredients(row.activeIngredientsJson);
  return {
    totalGrams: finite(row.totalGrams),
    calories: finite(row.calories),
    proteinG: finite(row.proteinG),
    carbsG: finite(row.carbsG),
    fatG: finite(row.fatG),
    fiberG: finite(row.fiberG),
    sugarG: finite(row.sugarG),
    sodiumMg: finite(row.sodiumMg),
    alcoholG: finite(row.alcoholG),
    caffeineMg: finite(row.caffeineMg),
    thcMg: finite(active.thcMg),
    cbdMg: finite(active.cbdMg),
  };
}

function emptyAccumulator(): NutritionAccumulator {
  return Object.fromEntries(
    Object.keys(EMPTY_NUTRITION).map((key) => [key, { total: 0, count: 0 }]),
  ) as NutritionAccumulator;
}

function addNutrition(accumulator: NutritionAccumulator, nutrition: WikiNutrition) {
  for (const key of Object.keys(EMPTY_NUTRITION) as Array<keyof WikiNutrition>) {
    const value = nutrition[key];
    if (value == null || value <= 0) continue;
    accumulator[key].total += value;
    accumulator[key].count += 1;
  }
}

function averageNutrition(accumulator: NutritionAccumulator): WikiNutrition {
  return Object.fromEntries(
    Object.keys(EMPTY_NUTRITION).map((key) => {
      const field = key as keyof WikiNutrition;
      const { total, count } = accumulator[field];
      return [field, count ? total / count : null];
    }),
  ) as WikiNutrition;
}

function parseIngredients(value: string | null) {
  if (!value) return [];
  const seen = new Set<string>();
  return value
    .replace(/\([^)]*\)/g, " ")
    .split(/[,;\n]/)
    .map((part) =>
      cleanName(part)
        .replace(/\b(contains|may contain|and\/or|less than \d+% of|organic)\b/gi, " ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((part) => part.length >= 3 && part.length <= 48 && !/^\d+$/.test(part))
    .map((part) => titleCase(part.toLowerCase()))
    .filter((part) => {
      const key = part.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function rowProductTitle(row: WikiSourceRow) {
  return cleanName(row.productName) || cleanName(row.rawName) || "Unknown product";
}

function rowBrand(row: WikiSourceRow) {
  return cleanName(row.productBrand) || cleanName(row.itemBrand);
}

function rowCategory(row: WikiSourceRow) {
  return cleanName(row.productCategory) || cleanName(row.itemCategory);
}

function rowSearchText(row: WikiSourceRow) {
  return [
    row.rawName,
    row.normalizedName,
    row.itemCategory,
    row.itemBrand,
    row.productName,
    row.productCategory,
    row.productBrand,
    row.vendor,
  ]
    .map((value) => value ?? "")
    .join(" ");
}

function rowSignalText(row: WikiSourceRow) {
  return [
    row.rawName,
    row.normalizedName,
    row.itemBrand,
    row.productName,
    row.productBrand,
    row.vendor,
  ]
    .map((value) => value ?? "")
    .join(" ");
}

function rowVendorText(row: WikiSourceRow) {
  return [row.vendor, row.itemBrand, row.productBrand]
    .map((value) => value ?? "")
    .join(" ");
}

function hasCannabisActiveIngredients(row: WikiSourceRow) {
  const active = parseActiveIngredients(row.activeIngredientsJson);
  return Boolean(
    (active.thcMg != null && active.thcMg > 0) ||
      (active.cbdMg != null && active.cbdMg > 0) ||
      CANNABIS_STRONG_SIGNAL_RE.test(row.activeIngredientsJson ?? ""),
  );
}

function isCannabisRow(row: WikiSourceRow) {
  const category = rowCategory(row).toLowerCase();
  const haystack = rowSearchText(row);
  const signalText = rowSignalText(row);
  const vendorText = rowVendorText(row);
  const hasActive = hasCannabisActiveIngredients(row);
  const hasVendor = CANNABIS_VENDOR_RE.test(vendorText);
  const hasStrongSignal = CANNABIS_STRONG_SIGNAL_RE.test(signalText);
  const hasWeakSignal = CANNABIS_SIGNAL_RE.test(signalText);
  const looksLikeFood = CANNABIS_FOOD_CONTEXT_RE.test(haystack);

  if (looksLikeFood && !hasActive && !hasVendor) return false;
  if (category === "cannabis") return hasActive || hasVendor || (hasStrongSignal && !looksLikeFood);
  return hasActive || hasVendor || hasStrongSignal || (hasWeakSignal && category !== "food" && category !== "drink");
}

function isAlcoholRow(row: WikiSourceRow) {
  const category = rowCategory(row).toLowerCase();
  const haystack = rowSearchText(row);
  const signalText = rowSignalText(row);
  const vendorText = rowVendorText(row);
  const looksLikeFood = ALCOHOL_FOOD_CONTEXT_RE.test(haystack);
  const hasVendor = ALCOHOL_VENDOR_RE.test(vendorText);
  const hasStrength = ALCOHOL_STRENGTH_RE.test(signalText);
  const hasDirectSignal = ALCOHOL_SIGNAL_RE.test(signalText);
  const hasAmbiguousSignal = AMBIGUOUS_ALCOHOL_SIGNAL_RE.test(signalText);

  if (looksLikeFood) return false;
  if (category === "alcohol" || category === "wine") return true;
  if (hasDirectSignal) return true;
  return hasAmbiguousSignal && (hasVendor || hasStrength);
}

function specialtyTitle(row: WikiSourceRow) {
  return rowProductTitle(row)
    .replace(/\b(pre[-\s]?roll|preroll|flower|bottle|wine|beer|cider)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim() || rowProductTitle(row);
}

function addEntry(
  map: Map<string, EntryAccumulator>,
  kind: WikiKind,
  slug: string,
  title: string,
  subtitle: string,
  row: WikiSourceRow,
  imageUrl: string | null,
) {
  const key = `${kind}:${slug}`;
  let entry = map.get(key);
  if (!entry) {
    entry = {
      kind,
      slug,
      title,
      subtitle,
      imageUrl,
      rows: [],
      nutrition: emptyAccumulator(),
    };
    map.set(key, entry);
  }
  entry.rows.push(row);
  if (!entry.imageUrl && imageUrl) entry.imageUrl = imageUrl;
  addNutrition(entry.nutrition, nutritionFromRow(row));
}

function latestDate(rows: WikiSourceRow[]) {
  return rows
    .map((row) => row.purchasedAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;
}

function totalSpend(rows: WikiSourceRow[]) {
  return rows.reduce((sum, row) => sum + (row.price ?? 0), 0);
}

function examples(rows: WikiSourceRow[]): WikiOccurrence[] {
  return [...rows]
    .sort((a, b) => (b.purchasedAt ?? "").localeCompare(a.purchasedAt ?? "") || b.lineItemId - a.lineItemId)
    .slice(0, 8)
    .map((row) => ({
      receiptId: row.receiptId,
      rawName: row.rawName,
      vendor: row.vendor,
      purchasedAt: row.purchasedAt,
      price: row.price,
    }));
}

function entrySummary(kind: WikiKind, rows: WikiSourceRow[], nutrition: WikiNutrition) {
  const vendors = new Set(rows.map((row) => cleanName(row.vendor)).filter(Boolean));
  const calories = nutrition.calories ? `${formatWikiNumber(nutrition.calories)} cal typical` : null;
  const spend = totalSpend(rows) > 0 ? `${formatWikiMoney(totalSpend(rows))} observed` : null;
  if (kind === "nutrient") return `${rows.length} matching items${spend ? ` · ${spend}` : ""}`;
  return [calories, spend, vendors.size ? `${vendors.size} vendors` : null].filter(Boolean).join(" · ");
}

function relatedForEntry(kind: WikiKind, rows: WikiSourceRow[], selfSlug: string) {
  const related = new Map<string, { kind: WikiKind; title: string; href: string; count: number }>();
  function add(kindValue: WikiKind, title: string, slug: string) {
    if (!title || (kindValue === kind && slug === selfSlug)) return;
    const key = `${kindValue}:${slug}`;
    const existing = related.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      related.set(key, { kind: kindValue, title, href: `/wiki/${kindValue}/${slug}`, count: 1 });
    }
  }
  for (const row of rows) {
    const brand = rowBrand(row);
    const category = rowCategory(row);
    const product = rowProductTitle(row);
    if (brand) add("brand", brand, slugify(brand));
    if (category) add("category", titleCase(category), slugify(category));
    if (product) add("product", product, productSlug(row));
    if (isCannabisRow(row)) add("strain", specialtyTitle(row), slugify(specialtyTitle(row)));
    if (isAlcoholRow(row)) add("bottle", rowProductTitle(row), productSlug(row));
    for (const ingredient of parseIngredients(row.ingredientsText).slice(0, 6)) {
      add("ingredient", ingredient, slugify(ingredient));
    }
    for (const nutrient of NUTRIENTS) {
      const value = nutritionFromRow(row)[nutrient.key];
      if (value && value > 0) add("nutrient", nutrient.title, nutrient.slug);
    }
  }
  return [...related.values()]
    .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title))
    .slice(0, 12)
    .map((item) => ({ kind: item.kind, title: item.title, href: item.href }));
}

function productSlug(row: WikiSourceRow) {
  const title = rowProductTitle(row);
  if (row.productId) return `${slugify(title)}-${row.productId}`;
  const normalized = cleanName(row.normalizedName) || title;
  return slugify(normalized);
}

async function getWikiRows() {
  return db
    .select({
      lineItemId: schema.lineItems.id,
      receiptId: schema.lineItems.receiptId,
      rawName: schema.lineItems.rawName,
      normalizedName: schema.lineItems.normalizedName,
      itemCategory: schema.lineItems.category,
      itemBrand: schema.lineItems.brand,
      price: schema.lineItems.price,
      productId: schema.lineItems.productId,
      productName: schema.productCatalog.displayName,
      productCategory: schema.productCatalog.category,
      productBrand: schema.productCatalog.brand,
      productImageUrl: schema.productCatalog.productImageUrl,
      vendor: schema.receipts.vendor,
      purchasedAt: schema.receipts.purchasedAt,
      totalGrams: schema.nutritionFacts.totalGrams,
      calories: schema.nutritionFacts.calories,
      proteinG: schema.nutritionFacts.proteinG,
      carbsG: schema.nutritionFacts.carbsG,
      fatG: schema.nutritionFacts.fatG,
      fiberG: schema.nutritionFacts.fiberG,
      sugarG: schema.nutritionFacts.sugarG,
      sodiumMg: schema.nutritionFacts.sodiumMg,
      alcoholG: schema.nutritionFacts.alcoholG,
      caffeineMg: schema.nutritionFacts.caffeineMg,
      ingredientsText: schema.nutritionFacts.ingredientsText,
      activeIngredientsJson: schema.nutritionFacts.activeIngredientsJson,
    })
    .from(schema.lineItems)
    .leftJoin(schema.receipts, eq(schema.receipts.id, schema.lineItems.receiptId))
    .leftJoin(schema.productCatalog, eq(schema.productCatalog.id, schema.lineItems.productId))
    .leftJoin(schema.nutritionFacts, eq(schema.nutritionFacts.lineItemId, schema.lineItems.id))
    .orderBy(desc(schema.lineItems.id));
}

function buildEntries(rows: WikiSourceRow[], options: { includeDetails?: boolean } = {}) {
  const map = new Map<string, EntryAccumulator>();

  for (const row of rows) {
    const product = rowProductTitle(row);
    addEntry(map, "product", productSlug(row), product, rowBrand(row) || rowCategory(row) || "Observed product", row, row.productImageUrl);

    const brand = rowBrand(row);
    if (brand) addEntry(map, "brand", slugify(brand), brand, "Brand", row, null);

    const category = rowCategory(row);
    if (category) addEntry(map, "category", slugify(category), titleCase(category), "Category", row, null);

    if (isCannabisRow(row)) {
      const strain = specialtyTitle(row);
      addEntry(map, "strain", slugify(strain), strain, rowBrand(row) || "Cannabis strain", row, row.productImageUrl);
    }

    if (isAlcoholRow(row)) {
      const bottle = rowProductTitle(row);
      addEntry(map, "bottle", productSlug(row), bottle, rowBrand(row) || "Alcohol bottle", row, row.productImageUrl);
    }

    for (const ingredient of parseIngredients(row.ingredientsText)) {
      addEntry(map, "ingredient", slugify(ingredient), ingredient, "Ingredient", row, null);
    }
  }

  for (const nutrient of NUTRIENTS) {
    for (const row of rows) {
      const value = nutritionFromRow(row)[nutrient.key];
      if (!value || value <= 0) continue;
      addEntry(map, "nutrient", nutrient.slug, nutrient.title, `${nutrient.subtitle} · ${nutrient.unit}`, row, null);
    }
  }

  return [...map.values()].map((entry): WikiEntry => {
    const nutrition = averageNutrition(entry.nutrition);
    return {
      kind: entry.kind,
      slug: entry.slug,
      href: `/wiki/${entry.kind}/${entry.slug}`,
      title: entry.title,
      subtitle: entry.subtitle,
      summary: entrySummary(entry.kind, entry.rows, nutrition),
      count: entry.rows.length,
      totalSpend: totalSpend(entry.rows),
      latestDate: latestDate(entry.rows),
      imageUrl: entry.imageUrl,
      nutrition,
      related: options.includeDetails ? relatedForEntry(entry.kind, entry.rows, entry.slug) : [],
      occurrences: options.includeDetails ? examples(entry.rows) : [],
    };
  });
}

function compactWikiEntry(entry: WikiEntry): WikiIndexEntry {
  return {
    kind: entry.kind,
    slug: entry.slug,
    href: entry.href,
    title: entry.title,
    subtitle: entry.subtitle,
    summary: entry.summary,
    count: entry.count,
    totalSpend: entry.totalSpend,
    imageUrl: entry.imageUrl,
  };
}

async function buildWikiIndex() {
  const rows = await getWikiRows();
  const entries = buildEntries(rows).map(compactWikiEntry);
  return {
    entries,
    counts: Object.fromEntries(
      WIKI_KINDS.map((kind) => [kind.key, entries.filter((entry) => entry.kind === kind.key).length]),
    ) as Record<WikiKind, number>,
  };
}

export const getWikiIndex = unstable_cache(buildWikiIndex, ["wiki-index", WIKI_CACHE_VERSION], {
  tags: [FOOD_DATA_CACHE_TAG],
  revalidate: FOOD_DATA_CACHE_SECONDS,
});

export const getWikiEntry = unstable_cache(
  async (kind: WikiKind, slug: string) => {
    const rows = await getWikiRows();
    return buildEntries(rows, { includeDetails: true }).find((entry) => entry.kind === kind && entry.slug === slug) ?? null;
  },
  ["wiki-entry", WIKI_CACHE_VERSION],
  {
    tags: [FOOD_DATA_CACHE_TAG],
    revalidate: FOOD_DATA_CACHE_SECONDS,
  },
);

export function sortWikiEntries<T extends Pick<WikiEntry, "count" | "totalSpend" | "title">>(entries: T[]) {
  return [...entries].sort((a, b) => b.count - a.count || b.totalSpend - a.totalSpend || a.title.localeCompare(b.title));
}
