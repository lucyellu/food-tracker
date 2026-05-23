import { eq } from "drizzle-orm";
import { db, schema } from "@/db/client";

const FDC_BASE_URL = "https://api.nal.usda.gov/fdc/v1";
const GRAMS_PER_LB = 453.59237;
const GRAMS_PER_OZ = 28.349523125;

const NUTRIENT_IDS = {
  calories: new Set([1008, 2047, 2048]),
  protein: new Set([1003]),
  fat: new Set([1004]),
  carbs: new Set([1005]),
  fiber: new Set([1079]),
  sugar: new Set([2000, 1063]),
  sodium: new Set([1093]),
  alcohol: new Set([1018]),
  caffeine: new Set([1057]),
};

const MINERAL_IDS = {
  calciumMg: new Set([1087]),
  ironMg: new Set([1089]),
  magnesiumMg: new Set([1090]),
  phosphorusMg: new Set([1091]),
  potassiumMg: new Set([1092]),
  sodiumMg: new Set([1093]),
  zincMg: new Set([1095]),
};

type LineItem = typeof schema.lineItems.$inferSelect;

type SearchFoodNutrient = {
  nutrientId?: number;
  nutrientName?: string;
  nutrientNumber?: string;
  unitName?: string;
  value?: number;
};

type DetailFoodNutrient = {
  nutrient?: {
    id?: number;
    number?: string;
    name?: string;
    unitName?: string;
  };
  amount?: number;
};

type FoodSearchResult = {
  fdcId: number;
  description: string;
  dataType?: string;
  brandOwner?: string;
  brandName?: string;
  ingredients?: string;
  servingSize?: number;
  servingSizeUnit?: string;
  foodNutrients?: SearchFoodNutrient[];
};

type FoodDetails = {
  fdcId: number;
  description: string;
  dataType?: string;
  brandOwner?: string;
  brandName?: string;
  ingredients?: string;
  servingSize?: number;
  servingSizeUnit?: string;
  foodNutrients?: Array<SearchFoodNutrient | DetailFoodNutrient>;
};

type FoodSearchResponse = {
  foods?: FoodSearchResult[];
};

type Per100gNutrition = {
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  fiberG: number | null;
  sugarG: number | null;
  sodiumMg: number | null;
  alcoholG: number | null;
  caffeineMg: number | null;
};

type Per100gMinerals = {
  calciumMg: number | null;
  ironMg: number | null;
  magnesiumMg: number | null;
  phosphorusMg: number | null;
  potassiumMg: number | null;
  sodiumMg: number | null;
  zincMg: number | null;
};

type MatchResult = {
  food: FoodDetails;
  score: number;
  query: string;
};

export type ReceiptNutritionResult = {
  total: number;
  matched: number;
  unmatched: number;
  skippedRefunded: number;
};

function getApiKey() {
  const apiKey = process.env.USDA_API_KEY;
  if (!apiKey) throw new Error("USDA_API_KEY is not set");
  return apiKey;
}

function normalizeName(value: string) {
  return value
    .replace(/^\[REFUNDED\]\s*/i, "")
    .replace(/&/g, " and ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/gi, " ")
    .replace(/\b(t t|tt|dan d pak|lee kum kee|kang shi fu|samlip|vita|yeshu|dom|mag mag)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function tokenSet(value: string) {
  return new Set(
    normalizeName(value)
      .split(" ")
      .filter((token) => token.length > 2 && !["with", "and", "the", "fresh", "frozen"].includes(token)),
  );
}

function uniq(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))));
}

function aliasesFor(rawName: string) {
  const n = normalizeName(rawName);
  const aliases: string[] = [];
  if (n.includes("soy sauce")) aliases.push("soy sauce");
  if (n.includes("watercress")) aliases.push("watercress raw");
  if (n.includes("seafood mushroom")) aliases.push("mushroom raw");
  if (n.includes("pork side ribs")) aliases.push("pork ribs raw");
  if (n.includes("duck gizzard")) aliases.push("chicken gizzard raw");
  if (n.includes("shiitake")) aliases.push("shiitake mushrooms raw");
  if (n.includes("radish") || n.includes("raddish")) aliases.push("pickled radish");
  if (n.includes("konjac")) aliases.push("konjac noodles");
  if (n.includes("cabbage")) aliases.push("cabbage raw");
  if (n.includes("egg")) aliases.push("egg whole raw");
  if (n.includes("apple")) aliases.push("apples raw with skin");
  if (n.includes("soup base") || n.includes("beef soup")) aliases.push("beef broth");
  if (n.includes("kimchi")) aliases.push("kimchi");
  if (n.includes("pork bung")) aliases.push("pork chitterlings");
  if (n.includes("walnut")) aliases.push("walnuts");
  if (n.includes("chrysanthemum tea")) aliases.push("tea beverage");
  if (n.includes("coconut juice")) aliases.push("coconut water");
  if (n.includes("aloe vera")) aliases.push("aloe vera drink");
  if (n.includes("noodles")) aliases.push("instant noodles");
  if (n.includes("rice crisp") || n.includes("rice cracker")) aliases.push("rice crackers");
  if (n.includes("mirin")) aliases.push("mirin");
  if (n.includes("basa")) aliases.push("fish raw");
  if (n.includes("red bean")) aliases.push("red bean pastry");
  if (n.includes("beef tendon meatballs")) aliases.push("beef meatballs");
  if (n.includes("fish head")) aliases.push("fish raw");
  if (n.includes("beef shank") || n.includes("tripe")) aliases.push("beef tripe");
  if (n.includes("shrimp dumpling")) aliases.push("shrimp dumplings");
  if (n.includes("salmon")) aliases.push("salmon smoked");
  if (n.includes("green onion")) aliases.push("scallions raw");
  if (n.includes("watermelon")) aliases.push("watermelon raw");
  if (n.includes("ice bar")) aliases.push("ice cream bar");
  if (n.includes("plum")) aliases.push("plums dried");
  if (n.includes("eel")) aliases.push("eel cooked");
  if (n.includes("squash")) aliases.push("summer squash raw");
  if (n.includes("fuzzy melon")) aliases.push("wax gourd raw");
  if (n.includes("kidney")) aliases.push("pork kidney raw");
  if (n.includes("bitter melon")) aliases.push("bitter melon raw");
  if (n.includes("mussel")) aliases.push("mussels cooked");
  if (n.includes("eggplant")) aliases.push("eggplant raw");
  return aliases;
}

function queriesFor(rawName: string) {
  const cleaned = normalizeName(rawName);
  const aliases = aliasesFor(rawName);
  return uniq([...aliases, cleaned]).slice(0, 4);
}

function dataTypeScore(dataType?: string) {
  if (dataType === "Foundation") return 8;
  if (dataType === "SR Legacy") return 7;
  if (dataType?.includes("FNDDS")) return 6;
  if (dataType === "Branded") return 4;
  return 0;
}

function scoreFood(query: string, food: FoodSearchResult) {
  const queryTokens = tokenSet(query);
  const descriptionTokens = tokenSet(food.description);
  if (queryTokens.size === 0 || descriptionTokens.size === 0) return 0;

  let overlap = 0;
  for (const token of queryTokens) {
    if (descriptionTokens.has(token)) overlap += 1;
  }

  const coverage = overlap / queryTokens.size;
  const exactBonus = normalizeName(food.description).includes(normalizeName(query)) ? 8 : 0;
  const hasCalories = food.foodNutrients?.some(
    (nutrient) =>
      typeof nutrient.value === "number" &&
      nutrient.nutrientId != null &&
      NUTRIENT_IDS.calories.has(nutrient.nutrientId),
  )
    ? 6
    : 0;
  return coverage * 20 + exactBonus + dataTypeScore(food.dataType) + hasCalories;
}

async function fdcFetch<T>(path: string, init?: RequestInit) {
  const url = new URL(`${FDC_BASE_URL}${path}`);
  url.searchParams.set("api_key", getApiKey());
  const res = await fetch(url, init);
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const message = typeof data?.message === "string" ? data.message : "FoodData Central request failed";
    throw new Error(`${message} (${res.status})`);
  }
  if (!data) throw new Error(`FoodData Central returned an empty response (${res.status})`);
  return data as T;
}

async function searchFoods(query: string) {
  const data = await fdcFetch<FoodSearchResponse>("/foods/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query,
      dataType: ["Foundation", "SR Legacy", "Survey (FNDDS)", "Branded"],
      pageSize: 8,
    }),
  });
  return data.foods ?? [];
}

async function getFoodDetails(fdcId: number, fallback: FoodSearchResult) {
  const [cached] = await db
    .select()
    .from(schema.usdaCache)
    .where(eq(schema.usdaCache.fdcId, fdcId))
    .limit(1);
  if (cached) return mergeFoodDetails(fallback, JSON.parse(cached.payloadJson) as FoodDetails);

  let details: FoodDetails;
  try {
    details = await fdcFetch<FoodDetails>(`/food/${fdcId}`);
  } catch (e) {
    console.warn(
      `Could not fetch USDA details for FDC ${fdcId}; using search payload: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
    details = fallback;
  }
  const merged = mergeFoodDetails(fallback, details);
  await db
    .insert(schema.usdaCache)
    .values({ fdcId, payloadJson: JSON.stringify(merged) })
    .onConflictDoUpdate({
      target: schema.usdaCache.fdcId,
      set: { payloadJson: JSON.stringify(merged) },
    });
  return merged;
}

function mergeFoodDetails(fallback: FoodSearchResult, details: FoodDetails): FoodDetails {
  return {
    ...fallback,
    ...details,
    foodNutrients: [...(details.foodNutrients ?? []), ...(fallback.foodNutrients ?? [])],
  };
}

async function findBestFood(rawName: string): Promise<MatchResult | null> {
  let best: { food: FoodSearchResult; score: number; query: string } | null = null;

  for (const query of queriesFor(rawName)) {
    const foods = await searchFoods(query);
    for (const food of foods) {
      const score = scoreFood(query, food);
      if (!best || score > best.score) {
        best = { food, score, query };
      }
    }
    if (best && best.score >= 28) break;
  }

  if (!best || best.score < 12) return null;
  return {
    food: await getFoodDetails(best.food.fdcId, best.food),
    score: best.score,
    query: best.query,
  };
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
  if (normalized === "fl_oz" || normalized === "floz") return value * 29.5735;
  return null;
}

function parsePackageGrams(rawName: string) {
  const compact = rawName.replace(/\s+/g, "");
  const multiA = compact.match(/(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)(kg|g|mg|ml|l|oz|lb)/i);
  if (multiA) return Number(multiA[1]) * (toGrams(Number(multiA[2]), multiA[3]) ?? 0);

  const multiB = compact.match(/(\d+(?:\.\d+)?)(kg|g|mg|ml|l|oz|lb)x(\d+(?:\.\d+)?)/i);
  if (multiB) return Number(multiB[3]) * (toGrams(Number(multiB[1]), multiB[2]) ?? 0);

  const single = compact.match(/(\d+(?:\.\d+)?)(kg|g|mg|ml|l|oz|lb)/i);
  if (single) return toGrams(Number(single[1]), single[2]);
  return null;
}

function estimateLineGrams(item: LineItem, food?: FoodDetails) {
  const explicitUnit = toGrams(item.quantity, item.unit);
  if (explicitUnit != null) return explicitUnit;

  const packageGrams = parsePackageGrams(item.rawName);
  if (packageGrams != null && packageGrams > 0) return item.quantity * packageGrams;

  if (food?.servingSize && food.servingSizeUnit) {
    const servingGrams = toGrams(food.servingSize, food.servingSizeUnit);
    if (servingGrams != null && item.quantity > 0) return item.quantity * servingGrams;
  }

  return null;
}

function nutrientShape(nutrient: SearchFoodNutrient | DetailFoodNutrient) {
  if ("nutrient" in nutrient && nutrient.nutrient) {
    return {
      id: nutrient.nutrient?.id,
      name: nutrient.nutrient?.name,
      unitName: nutrient.nutrient?.unitName,
      value: nutrient.amount,
    };
  }

  const searchNutrient = nutrient as SearchFoodNutrient;
  return {
    id: searchNutrient.nutrientId,
    name: searchNutrient.nutrientName,
    unitName: searchNutrient.unitName,
    value: searchNutrient.value,
  };
}

function getNutrient(food: FoodDetails, ids: Set<number>) {
  for (const nutrient of food.foodNutrients ?? []) {
    const shaped = nutrientShape(nutrient);
    if (shaped.id && ids.has(shaped.id) && typeof shaped.value === "number") {
      return shaped.value;
    }
  }
  return null;
}

function scale(value: number | null, factor: number | null) {
  return value == null || factor == null ? null : Number((value * factor).toFixed(2));
}

function per100gNutrition(food: FoodDetails): Per100gNutrition {
  return {
    calories: getNutrient(food, NUTRIENT_IDS.calories),
    proteinG: getNutrient(food, NUTRIENT_IDS.protein),
    carbsG: getNutrient(food, NUTRIENT_IDS.carbs),
    fatG: getNutrient(food, NUTRIENT_IDS.fat),
    fiberG: getNutrient(food, NUTRIENT_IDS.fiber),
    sugarG: getNutrient(food, NUTRIENT_IDS.sugar),
    sodiumMg: getNutrient(food, NUTRIENT_IDS.sodium),
    alcoholG: getNutrient(food, NUTRIENT_IDS.alcohol),
    caffeineMg: getNutrient(food, NUTRIENT_IDS.caffeine),
  };
}

function per100gMinerals(food: FoodDetails): Per100gMinerals {
  return {
    calciumMg: getNutrient(food, MINERAL_IDS.calciumMg),
    ironMg: getNutrient(food, MINERAL_IDS.ironMg),
    magnesiumMg: getNutrient(food, MINERAL_IDS.magnesiumMg),
    phosphorusMg: getNutrient(food, MINERAL_IDS.phosphorusMg),
    potassiumMg: getNutrient(food, MINERAL_IDS.potassiumMg),
    sodiumMg: getNutrient(food, MINERAL_IDS.sodiumMg),
    zincMg: getNutrient(food, MINERAL_IDS.zincMg),
  };
}

function nutrientGroups(food: FoodDetails, factor: number | null) {
  const vitamins: Record<string, number> = {};
  const minerals: Record<string, number> = {};
  for (const nutrient of food.foodNutrients ?? []) {
    const shaped = nutrientShape(nutrient);
    if (!shaped.name || typeof shaped.value !== "number") continue;
    const lowerName = shaped.name.toLowerCase();
    const scaled = scale(shaped.value, factor);
    if (scaled == null) continue;
    const label = `${shaped.name}${shaped.unitName ? ` (${shaped.unitName})` : ""}`;
    if (lowerName.includes("vitamin") || lowerName.includes("folate") || lowerName.includes("choline")) {
      vitamins[label] = scaled;
    } else if (
      ["calcium", "iron", "magnesium", "phosphorus", "potassium", "sodium", "zinc", "copper", "manganese", "selenium"].some(
        (name) => lowerName.includes(name),
      )
    ) {
      minerals[label] = scaled;
    }
  }
  return { vitamins, minerals };
}

async function saveNutrition(item: LineItem, match: MatchResult) {
  const grams = estimateLineGrams(item, match.food);
  const factor = grams == null ? null : grams / 100;
  const per100g = per100gNutrition(match.food);
  const mineralsPer100g = per100gMinerals(match.food);
  const groups = nutrientGroups(match.food, factor);
  const fdcServingGrams =
    match.food.servingSize && match.food.servingSizeUnit
      ? toGrams(match.food.servingSize, match.food.servingSizeUnit)
      : null;
  const sourceMeta = {
    source: "USDA FoodData Central",
    fdcId: match.food.fdcId,
    description: match.food.description,
    dataType: match.food.dataType,
    query: match.query,
    score: Number(match.score.toFixed(2)),
    basis: grams == null ? "per_100g_reference_only" : "estimated_line_total",
    serving: {
      purchasedGrams: grams == null ? null : Number(grams.toFixed(2)),
      fdcServingSize: match.food.servingSize ?? null,
      fdcServingSizeUnit: match.food.servingSizeUnit ?? null,
      fdcServingGrams,
      estimatedServings:
        grams != null && fdcServingGrams != null && fdcServingGrams > 0
          ? Number((grams / fdcServingGrams).toFixed(2))
          : null,
    },
    per100g,
    per100gMinerals: mineralsPer100g,
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
      vitaminsJson: JSON.stringify(groups.vitamins),
      mineralsJson: JSON.stringify(groups.minerals),
      ingredientsText: match.food.ingredients ?? null,
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
        vitaminsJson: JSON.stringify(groups.vitamins),
        mineralsJson: JSON.stringify(groups.minerals),
        ingredientsText: match.food.ingredients ?? null,
        activeIngredientsJson: JSON.stringify(sourceMeta),
      },
    });

  await db
    .update(schema.lineItems)
    .set({
      fdcId: match.food.fdcId,
      normalizedName: match.food.description,
      brand: match.food.brandName ?? match.food.brandOwner ?? null,
      nutritionStatus: "matched",
    })
    .where(eq(schema.lineItems.id, item.id));
}

async function markUnmatched(item: LineItem) {
  await db.delete(schema.nutritionFacts).where(eq(schema.nutritionFacts.lineItemId, item.id));
  await db
    .update(schema.lineItems)
    .set({
      fdcId: null,
      normalizedName: null,
      brand: null,
      nutritionStatus: "unmatched",
    })
    .where(eq(schema.lineItems.id, item.id));
}

export async function enrichReceiptNutrition(receiptId: number): Promise<ReceiptNutritionResult> {
  const items = await db
    .select()
    .from(schema.lineItems)
    .where(eq(schema.lineItems.receiptId, receiptId));

  const result: ReceiptNutritionResult = {
    total: items.length,
    matched: 0,
    unmatched: 0,
    skippedRefunded: 0,
  };

  for (const item of items) {
    if (/^\[REFUNDED\]/i.test(item.rawName)) {
      result.skippedRefunded += 1;
      continue;
    }

    const match = await findBestFood(item.rawName);
    if (!match) {
      await markUnmatched(item);
      result.unmatched += 1;
      continue;
    }

    await saveNutrition(item, match);
    result.matched += 1;
  }

  return result;
}
