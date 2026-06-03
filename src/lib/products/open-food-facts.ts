import "server-only";

import { eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import type { Category } from "@/lib/products/category";
import { normalizeProductName, syncProductCatalogMetadata } from "@/lib/products/catalog";

const PRODUCT_API_BASE = "https://world.openfoodfacts.org/api/v3.6/product";
const PRODUCT_PAGE_BASE = "https://world.openfoodfacts.org/product";
const SEARCH_URL = "https://search.openfoodfacts.org/search";
const SOURCE = "open_food_facts";
const SOURCE_LABEL = "Open Food Facts";
const GRAMS_PER_LB = 453.59237;
const GRAMS_PER_OZ = 28.349523125;
const ML_PER_FL_OZ = 29.5735;
const SEARCH_LIMIT_PER_RECEIPT = Number(process.env.OPEN_FOOD_FACTS_SEARCH_LIMIT_PER_RECEIPT ?? 8);
const MIN_SEARCH_MATCH_SCORE = 20;

type LineItem = typeof schema.lineItems.$inferSelect;
type ProductCatalogItem = typeof schema.productCatalog.$inferSelect;

type OpenFoodFactsProduct = {
  code?: string | number | null;
  product_name?: string | null;
  product_name_en?: string | null;
  generic_name?: string | null;
  generic_name_en?: string | null;
  brands?: string | string[] | null;
  quantity?: string | null;
  serving_size?: string | null;
  image_url?: string | null;
  image_front_url?: string | null;
  image_small_url?: string | null;
  image_front_small_url?: string | null;
  image_thumb_url?: string | null;
  image_front_thumb_url?: string | null;
  categories_tags?: string[] | null;
  ingredients_text?: string | null;
  ingredients_text_en?: string | null;
  nutriments?: Record<string, unknown> | null;
};

type ProductApiResponse = {
  product?: OpenFoodFactsProduct | null;
  status?: string | number;
};

type SearchResponse = {
  hits?: OpenFoodFactsProduct[];
};

type LookupResult = {
  product: OpenFoodFactsProduct | null;
  searched: boolean;
  source: "catalog" | "barcode" | "search";
};

export type OpenFoodFactsLineItemResult = {
  matched: boolean;
  searched: boolean;
  nutritionMatched: boolean;
  source: "catalog" | "barcode" | "search" | null;
  code: string | null;
  error?: string;
};

function userAgent() {
  return process.env.OPEN_FOOD_FACTS_USER_AGENT?.trim() || "FoodTracker/0.1 (local app)";
}

async function fetchJson<T>(url: URL | string): Promise<T> {
  const res = await fetch(url, {
    cache: "no-store",
    headers: {
      accept: "application/json",
      "user-agent": userAgent(),
    },
  });
  const contentType = res.headers.get("content-type") ?? "";
  if (!res.ok) throw new Error(`Open Food Facts returned ${res.status}`);
  if (!contentType.includes("json")) throw new Error("Open Food Facts returned a non-JSON response");
  return (await res.json()) as T;
}

function cleanText(value: string | null | undefined) {
  const text = value?.trim();
  return text ? text : null;
}

function codeOf(product: OpenFoodFactsProduct) {
  const code = product.code == null ? null : String(product.code).trim();
  return code && /^\d{4,14}$/.test(code) ? code : null;
}

function productName(product: OpenFoodFactsProduct) {
  return (
    cleanText(product.product_name_en) ??
    cleanText(product.product_name) ??
    cleanText(product.generic_name_en) ??
    cleanText(product.generic_name)
  );
}

function brandName(product: OpenFoodFactsProduct) {
  if (Array.isArray(product.brands)) return cleanText(product.brands.join(", "));
  return cleanText(product.brands ?? null);
}

function productImage(product: OpenFoodFactsProduct) {
  return (
    cleanText(product.image_front_url) ??
    cleanText(product.image_url) ??
    cleanText(product.image_front_small_url) ??
    cleanText(product.image_small_url) ??
    cleanText(product.image_front_thumb_url) ??
    cleanText(product.image_thumb_url)
  );
}

function productUrl(code: string | null) {
  return code ? `${PRODUCT_PAGE_BASE}/${code}` : null;
}

function numberValue(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function nutrient(product: OpenFoodFactsProduct, keys: string[]) {
  const nutriments = product.nutriments ?? {};
  for (const key of keys) {
    const value = numberValue(nutriments[key]);
    if (value != null) return value;
  }
  return null;
}

function per100gNutrition(product: OpenFoodFactsProduct) {
  const sodiumG = nutrient(product, ["sodium_100g"]);
  const saltG = nutrient(product, ["salt_100g"]);
  return {
    calories: nutrient(product, ["energy-kcal_100g", "energy-kcal_value"]),
    proteinG: nutrient(product, ["proteins_100g", "proteins_value"]),
    carbsG: nutrient(product, ["carbohydrates_100g", "carbohydrates_value"]),
    fatG: nutrient(product, ["fat_100g", "fat_value"]),
    fiberG: nutrient(product, ["fiber_100g", "fiber_value"]),
    sugarG: nutrient(product, ["sugars_100g", "sugars_value"]),
    sodiumMg: sodiumG != null ? sodiumG * 1000 : saltG != null ? saltG * 400 : null,
    alcoholG: nutrient(product, ["alcohol_100g", "alcohol_value"]),
    caffeineMg: scale(nutrient(product, ["caffeine_100g", "caffeine_value"]), 1000),
  };
}

function scale(value: number | null, factor: number | null) {
  return value == null || factor == null ? null : Number((value * factor).toFixed(2));
}

function hasNutrition(product: OpenFoodFactsProduct) {
  return Object.values(per100gNutrition(product)).some((value) => value != null);
}

function categoryFromProduct(product: OpenFoodFactsProduct): Category {
  const tags = (product.categories_tags ?? []).join(" ").toLowerCase();
  if (/\b(beverage|beverages|drink|drinks|soda|juice|tea|coffee|water)\b/.test(tags)) return "drink";
  if (/\b(supplement|supplements|vitamin|vitamins)\b/.test(tags)) return "supplement";
  return "food";
}

function tokenSet(value: string) {
  return new Set(
    normalizeProductName(value)
      .split(" ")
      .filter((token) => token.length > 2 && !["and", "with", "the", "for", "from"].includes(token)),
  );
}

function scoreProduct(query: string, product: OpenFoodFactsProduct) {
  const name = productName(product);
  if (!name) return 0;
  const queryTokens = tokenSet(query);
  const productTokens = tokenSet(`${name} ${brandName(product) ?? ""}`);
  if (queryTokens.size === 0 || productTokens.size === 0) return 0;

  let overlap = 0;
  for (const token of queryTokens) {
    if (productTokens.has(token)) overlap += 1;
  }
  if (overlap === 0) return 0;

  const normalizedQuery = normalizeProductName(query);
  const normalizedName = normalizeProductName(name);
  return (
    (overlap / queryTokens.size) * 20 +
    (normalizedName.includes(normalizedQuery) || normalizedQuery.includes(normalizedName) ? 8 : 0) +
    (productImage(product) ? 2 : 0) +
    (hasNutrition(product) ? 4 : 0)
  );
}

function barcodeFromItem(item: LineItem, product: ProductCatalogItem | null) {
  const catalogBarcode = cleanText(product?.barcode);
  if (catalogBarcode && /^\d{8}$|^\d{12,14}$/.test(catalogBarcode)) return catalogBarcode;

  const sku = cleanText(item.retailerSku);
  if (sku && /^\d{8}$|^\d{12,14}$/.test(sku)) return sku;

  const labelled = item.rawName.match(/\b(?:upc|ean|gtin|barcode)\s*[:#-]?\s*(\d{8}|\d{12,14})\b/i);
  return labelled?.[1] ?? null;
}

function isSearchCandidate(item: LineItem, product: ProductCatalogItem | null) {
  const category = item.category ?? product?.category;
  return !category || category === "food" || category === "drink" || category === "supplement";
}

function searchQueryForItem(item: LineItem) {
  const cleaned = item.rawName
    .replace(/^\[REFUNDED\]\s*/i, "")
    .replace(/\b\d+(?:\.\d+)?\s*(?:g|kg|mg|ml|l|oz|lb|lbs|fl_oz|pack|ct|count)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalizeProductName(cleaned).length >= 4 ? cleaned : null;
}

async function fetchProductByCode(code: string) {
  const data = await fetchJson<ProductApiResponse>(`${PRODUCT_API_BASE}/${encodeURIComponent(code)}.json`);
  return data.product && productName(data.product) ? data.product : null;
}

async function searchProduct(query: string) {
  const url = new URL(SEARCH_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("page_size", "5");
  const data = await fetchJson<SearchResponse>(url);
  let best: { product: OpenFoodFactsProduct; score: number } | null = null;
  for (const product of data.hits ?? []) {
    const score = scoreProduct(query, product);
    if (!best || score > best.score) best = { product, score };
  }
  return best && best.score >= MIN_SEARCH_MATCH_SCORE ? best.product : null;
}

async function findProductForItem(
  item: LineItem,
  product: ProductCatalogItem | null,
  allowSearch: boolean,
): Promise<LookupResult | null> {
  if (product?.externalSource === SOURCE && product.externalId) {
    const matched = await fetchProductByCode(product.externalId);
    if (matched) return { product: matched, searched: false, source: "catalog" };
  }

  const barcode = barcodeFromItem(item, product);
  if (barcode) {
    const matched = await fetchProductByCode(barcode);
    if (matched) return { product: matched, searched: false, source: "barcode" };
  }

  if (!allowSearch || !isSearchCandidate(item, product)) return null;
  const query = searchQueryForItem(item);
  if (!query) return null;
  const matched = await searchProduct(query);
  return { product: matched, searched: true, source: "search" };
}

function toGrams(value: number, unit: string) {
  const normalized = unit.toLowerCase().replace(/\s+/g, "_");
  if (normalized === "g") return value;
  if (normalized === "kg") return value * 1000;
  if (normalized === "mg") return value / 1000;
  if (normalized === "oz") return value * GRAMS_PER_OZ;
  if (normalized === "lb" || normalized === "lbs") return value * GRAMS_PER_LB;
  if (normalized === "ml") return value;
  if (normalized === "l") return value * 1000;
  if (normalized === "fl_oz" || normalized === "floz") return value * ML_PER_FL_OZ;
  return null;
}

function parsePackageGrams(value: string | null | undefined) {
  const compact = value?.replace(/\s+/g, "") ?? "";
  const unit = "(kg|mg|ml|oz|lb|g|l)(?![a-z])";
  const multiA = compact.match(new RegExp(`(\\d+(?:\\.\\d+)?)x(\\d+(?:\\.\\d+)?)${unit}`, "i"));
  if (multiA) return Number(multiA[1]) * (toGrams(Number(multiA[2]), multiA[3]) ?? 0);

  const multiB = compact.match(new RegExp(`(\\d+(?:\\.\\d+)?)${unit}x(\\d+(?:\\.\\d+)?)`, "i"));
  if (multiB) return Number(multiB[3]) * (toGrams(Number(multiB[1]), multiB[2]) ?? 0);

  const single = compact.match(new RegExp(`(\\d+(?:\\.\\d+)?)${unit}`, "i"));
  if (single) return toGrams(Number(single[1]), single[2]);
  return null;
}

function estimateLineGrams(item: LineItem, product: OpenFoodFactsProduct) {
  const explicit = toGrams(item.quantity, item.unit);
  if (explicit != null) return explicit;

  const productQuantity = parsePackageGrams(product.quantity);
  if (productQuantity != null && productQuantity > 0) return item.quantity * productQuantity;

  const serving = parsePackageGrams(product.serving_size);
  if (serving != null && serving > 0) return item.quantity * serving;

  const rawQuantity = parsePackageGrams(item.rawName);
  if (rawQuantity != null && rawQuantity > 0) return item.quantity * rawQuantity;

  return null;
}

function metadataForProduct(product: OpenFoodFactsProduct) {
  const code = codeOf(product);
  return {
    normalizedName: productName(product),
    category: categoryFromProduct(product),
    brand: brandName(product),
    barcode: code,
    externalSource: SOURCE,
    externalId: code,
    productSource: SOURCE_LABEL,
    productUrl: productUrl(code),
    productImageUrl: productImage(product),
  };
}

async function saveNutrition(item: LineItem, product: OpenFoodFactsProduct) {
  const per100g = per100gNutrition(product);
  if (!Object.values(per100g).some((value) => value != null)) return false;

  const grams = estimateLineGrams(item, product);
  const factor = grams == null ? null : grams / 100;
  const code = codeOf(product);
  const sourceMeta = {
    source: SOURCE_LABEL,
    code,
    productUrl: productUrl(code),
    productName: productName(product),
    brand: brandName(product),
    basis: grams == null ? "per_100g_reference_only" : "estimated_line_total",
    quantity: product.quantity ?? null,
    servingSize: product.serving_size ?? null,
    per100g,
  };

  await db
    .insert(schema.nutritionFacts)
    .values({
      lineItemId: item.id,
      totalGrams: grams == null ? null : Number(grams.toFixed(2)),
      calories: scale(per100g.calories, factor),
      proteinG: scale(per100g.proteinG, factor),
      carbsG: scale(per100g.carbsG, factor),
      fatG: scale(per100g.fatG, factor),
      fiberG: scale(per100g.fiberG, factor),
      sugarG: scale(per100g.sugarG, factor),
      sodiumMg: scale(per100g.sodiumMg, factor),
      alcoholG: scale(per100g.alcoholG, factor),
      caffeineMg: scale(per100g.caffeineMg, factor),
      vitaminsJson: "{}",
      mineralsJson: "{}",
      ingredientsText: product.ingredients_text_en ?? product.ingredients_text ?? null,
      activeIngredientsJson: JSON.stringify(sourceMeta),
    })
    .onConflictDoUpdate({
      target: schema.nutritionFacts.lineItemId,
      set: {
        totalGrams: grams == null ? null : Number(grams.toFixed(2)),
        calories: scale(per100g.calories, factor),
        proteinG: scale(per100g.proteinG, factor),
        carbsG: scale(per100g.carbsG, factor),
        fatG: scale(per100g.fatG, factor),
        fiberG: scale(per100g.fiberG, factor),
        sugarG: scale(per100g.sugarG, factor),
        sodiumMg: scale(per100g.sodiumMg, factor),
        alcoholG: scale(per100g.alcoholG, factor),
        caffeineMg: scale(per100g.caffeineMg, factor),
        vitaminsJson: "{}",
        mineralsJson: "{}",
        ingredientsText: product.ingredients_text_en ?? product.ingredients_text ?? null,
        activeIngredientsJson: JSON.stringify(sourceMeta),
      },
    });

  await db
    .update(schema.lineItems)
    .set({ nutritionStatus: "matched" })
    .where(eq(schema.lineItems.id, item.id));

  return true;
}

function compactLineItemPatch(product: OpenFoodFactsProduct) {
  const metadata = metadataForProduct(product);
  return Object.fromEntries(
    Object.entries({
      normalizedName: metadata.normalizedName,
      category: metadata.category,
      brand: metadata.brand,
      productSource: metadata.productSource,
      productUrl: metadata.productUrl,
      productImageUrl: metadata.productImageUrl,
    }).filter(([, value]) => value != null),
  ) as Partial<typeof schema.lineItems.$inferInsert>;
}

export function openFoodFactsSearchLimitPerReceipt() {
  return Number.isFinite(SEARCH_LIMIT_PER_RECEIPT) && SEARCH_LIMIT_PER_RECEIPT > 0
    ? Math.floor(SEARCH_LIMIT_PER_RECEIPT)
    : 8;
}

export async function enrichLineItemWithOpenFoodFacts({
  item,
  product,
  allowSearch = true,
}: {
  item: LineItem;
  product: ProductCatalogItem | null;
  allowSearch?: boolean;
}): Promise<OpenFoodFactsLineItemResult> {
  try {
    const lookup = await findProductForItem(item, product, allowSearch);
    if (!lookup?.product) {
      return {
        matched: false,
        searched: lookup?.searched ?? false,
        nutritionMatched: false,
        source: lookup?.source ?? null,
        code: null,
      };
    }

    const metadata = metadataForProduct(lookup.product);
    await syncProductCatalogMetadata(product?.id ?? item.productId, metadata);

    const linePatch = compactLineItemPatch(lookup.product);
    if (Object.keys(linePatch).length > 0) {
      await db.update(schema.lineItems).set(linePatch).where(eq(schema.lineItems.id, item.id));
    }

    const nutritionMatched = await saveNutrition({ ...item, ...linePatch }, lookup.product);
    return {
      matched: true,
      searched: lookup.searched,
      nutritionMatched,
      source: lookup.source,
      code: metadata.externalId ?? null,
    };
  } catch (error) {
    return {
      matched: false,
      searched: false,
      nutritionMatched: false,
      source: null,
      code: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
