import "server-only";

import OpenAI from "openai";
import { z } from "zod";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { FOOD_KINDS } from "@/db/schema";
import { withRetry } from "@/lib/llm/util";

// Groups retailer products ("Cilantro (1bunch)", "Cilantro - Bunch, Fresh")
// into canonical foods so purchase history, lifetimes and imagery are shared.

const PANTRY_CATEGORIES = ["food", "drink"];
const DEFAULT_BATCH = 60;

const SYSTEM_PROMPT = `You sort grocery products into canonical foods for a personal pantry app.

For each product, pick the food a person would think of as "the same thing in my fridge":
- Drop brands, sizes, pack counts and marketing words. Varieties collapse when they are used the same way ("Envy Apple (3lb)" and "Cosmic Crisp Apple" -> apple), but keep genuinely different foods apart ("cabbage kimchi" vs "radish kimchi", "soy milk" vs "milk").
- slug: lowercase, singular, hyphenated English (e.g. "green-onion", "soy-sauce", "konjac-noodles").
- REUSE an existing slug from the provided list whenever it fits; only invent a new slug when none does.
- name: short display name in Title Case ("Green Onion").
- emoji: the single closest food emoji.
- kind: one of ${FOOD_KINDS.join(", ")}. condiment = sauces, oils, vinegars, pastes; spice = dried seasonings; prepared = ready-to-eat meals, deli, kimchi and other banchan; non_food = anything not eaten.
- shelf_life_days: days before a bought/opened package typically spoils at home.
- typical_finish_days: days one adult typically takes to use up one package of this size.

Return JSON: {"assignments":[{"product_id":number,"slug":string,"name":string,"emoji":string,"kind":string,"shelf_life_days":number,"typical_finish_days":number}]}
Include every product exactly once.`;

const AssignmentSchema = z.object({
  product_id: z.number().int(),
  slug: z
    .string()
    .transform((s) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""))
    .pipe(z.string().min(1)),
  name: z.string().trim().min(1),
  emoji: z.string().trim().nullish(),
  kind: z.enum(FOOD_KINDS).catch("pantry"),
  shelf_life_days: z.coerce.number().positive().catch(7),
  typical_finish_days: z.coerce.number().positive().catch(7),
});

const ResponseSchema = z.object({ assignments: z.array(z.unknown()) });

type Assignment = z.infer<typeof AssignmentSchema>;

function getClient() {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY is not set");
  return new OpenAI({ apiKey, baseURL: "https://api.deepseek.com", timeout: 120_000 });
}

async function requestAssignments(
  products: { id: number; displayName: string; brand: string | null }[],
  existingFoods: { slug: string; name: string }[],
): Promise<Assignment[]> {
  const client = getClient();
  const user = JSON.stringify({
    existing_foods: existingFoods.map((f) => f.slug),
    products: products.map((p) => ({
      product_id: p.id,
      name: p.displayName,
      ...(p.brand ? { brand: p.brand } : {}),
    })),
  });

  const raw = await withRetry(
    async () => {
      const res = await client.chat.completions.create({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
        temperature: 0,
      });
      return res.choices[0]?.message?.content ?? "";
    },
    { label: "Food canonicalize", attempts: 3, baseDelayMs: 1500 },
  );

  const parsed = ResponseSchema.parse(JSON.parse(raw));
  const wanted = new Set(products.map((p) => p.id));
  // Validate rows individually so one malformed entry doesn't sink the batch.
  return parsed.assignments.flatMap((row) => {
    const result = AssignmentSchema.safeParse(row);
    return result.success && wanted.has(result.data.product_id) ? [result.data] : [];
  });
}

async function upsertFoods(assignments: Assignment[]) {
  const bySlug = new Map<string, Assignment>();
  for (const a of assignments) if (!bySlug.has(a.slug)) bySlug.set(a.slug, a);
  if (bySlug.size === 0) return new Map<string, number>();

  const slugs = [...bySlug.keys()];
  const before = await db
    .select({ slug: schema.foods.slug })
    .from(schema.foods)
    .where(inArray(schema.foods.slug, slugs));
  const existing = new Set(before.map((f) => f.slug));

  const fresh = [...bySlug.values()].filter((a) => !existing.has(a.slug));
  if (fresh.length > 0) {
    await db
      .insert(schema.foods)
      .values(
        fresh.map((a) => ({
          slug: a.slug,
          name: a.name,
          emoji: a.emoji ?? null,
          kind: a.kind,
          shelfLifeDays: Math.round(a.shelf_life_days),
          typicalFinishDays: Math.round(Math.min(a.typical_finish_days, a.shelf_life_days)),
        })),
      )
      .onConflictDoNothing();
  }

  const rows = await db
    .select({ id: schema.foods.id, slug: schema.foods.slug })
    .from(schema.foods)
    .where(inArray(schema.foods.slug, slugs));
  return new Map(rows.map((r) => [r.slug, r.id]));
}

export type CanonicalizeResult = {
  processed: number;
  assigned: number;
  newFoods: number;
  remaining: number;
};

/**
 * Assigns a canonical food to products that don't have one yet. Pass
 * `productIds` to restrict to specific products (e.g. right after a receipt is
 * saved); otherwise processes the next batch of unassigned pantry products.
 */
export async function canonicalizeProducts({
  productIds,
  limit = DEFAULT_BATCH,
}: { productIds?: number[]; limit?: number } = {}): Promise<CanonicalizeResult> {
  const unassigned = and(
    isNull(schema.productCatalog.foodId),
    inArray(schema.lineItems.category, PANTRY_CATEGORIES),
    productIds ? inArray(schema.productCatalog.id, productIds) : undefined,
  );

  const products = await db
    .selectDistinct({
      id: schema.productCatalog.id,
      displayName: schema.productCatalog.displayName,
      brand: schema.productCatalog.brand,
    })
    .from(schema.productCatalog)
    .innerJoin(schema.lineItems, eq(schema.lineItems.productId, schema.productCatalog.id))
    .where(unassigned)
    .limit(limit);

  const countRemaining = async () => {
    const [row] = await db
      .select({ n: sql<number>`count(distinct ${schema.productCatalog.id})` })
      .from(schema.productCatalog)
      .innerJoin(schema.lineItems, eq(schema.lineItems.productId, schema.productCatalog.id))
      .where(unassigned);
    return Number(row?.n ?? 0);
  };

  if (products.length === 0) {
    return { processed: 0, assigned: 0, newFoods: 0, remaining: 0 };
  }

  const existingFoods = await db
    .select({ slug: schema.foods.slug, name: schema.foods.name })
    .from(schema.foods);
  const foodsBefore = existingFoods.length;

  const assignments = await requestAssignments(products, existingFoods);
  const foodIds = await upsertFoods(assignments);

  let assigned = 0;
  for (const a of assignments) {
    const foodId = foodIds.get(a.slug);
    if (!foodId) continue;
    await db
      .update(schema.productCatalog)
      .set({ foodId })
      .where(eq(schema.productCatalog.id, a.product_id));
    assigned++;
  }

  const [{ n: foodsAfter }] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.foods);

  return {
    processed: products.length,
    assigned,
    newFoods: Number(foodsAfter) - foodsBefore,
    remaining: await countRemaining(),
  };
}
