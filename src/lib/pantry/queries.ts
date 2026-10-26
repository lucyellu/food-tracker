import "server-only";

import { unstable_cache } from "next/cache";
import { and, asc, desc, eq, isNotNull, notInArray, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { FOOD_DATA_CACHE_SECONDS, FOOD_DATA_CACHE_TAG } from "@/lib/food-data-cache";
import type { FoodHistory, PantryFood, Purchase } from "./model";

const EXCLUDED_STATUSES = ["refunded", "unavailable"] as const;

async function loadFoodHistories(): Promise<FoodHistory[]> {
  const rows = await db
    .select({
      foodId: schema.foods.id,
      slug: schema.foods.slug,
      name: schema.foods.name,
      emoji: schema.foods.emoji,
      kind: schema.foods.kind,
      shelfLifeDays: schema.foods.shelfLifeDays,
      typicalFinishDays: schema.foods.typicalFinishDays,
      imageUrl: schema.foods.imageUrl,
      lineItemId: schema.lineItems.id,
      receiptId: schema.receipts.id,
      vendor: schema.receipts.vendor,
      date: schema.receipts.purchasedAt,
      productName: schema.productCatalog.displayName,
      quantity: schema.lineItems.quantity,
      unit: schema.lineItems.unit,
      price: schema.lineItems.price,
    })
    .from(schema.lineItems)
    .innerJoin(schema.receipts, eq(schema.receipts.id, schema.lineItems.receiptId))
    .innerJoin(schema.productCatalog, eq(schema.productCatalog.id, schema.lineItems.productId))
    .innerJoin(schema.foods, eq(schema.foods.id, schema.productCatalog.foodId))
    .where(
      and(
        isNotNull(schema.receipts.purchasedAt),
        notInArray(schema.lineItems.consumptionStatus, [...EXCLUDED_STATUSES]),
      ),
    )
    .orderBy(asc(schema.receipts.purchasedAt));

  const byFood = new Map<number, FoodHistory>();
  for (const row of rows) {
    const date = row.date?.slice(0, 10);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    let history = byFood.get(row.foodId);
    if (!history) {
      const food: PantryFood = {
        id: row.foodId,
        slug: row.slug,
        name: row.name,
        emoji: row.emoji,
        kind: row.kind,
        shelfLifeDays: row.shelfLifeDays,
        typicalFinishDays: row.typicalFinishDays,
        imageUrl: row.imageUrl,
      };
      history = { food, purchases: [] };
      byFood.set(row.foodId, history);
    }
    const purchase: Purchase = {
      date,
      lineItemId: row.lineItemId,
      receiptId: row.receiptId,
      vendor: row.vendor,
      productName: row.productName,
      quantity: row.quantity,
      unit: row.unit,
      price: row.price,
    };
    history.purchases.push(purchase);
  }
  const finished = await db.select().from(schema.foodFinished);
  for (const f of finished) {
    const history = byFood.get(f.foodId);
    if (history) history.finishedAt = f.finishedAt;
  }
  return [...byFood.values()];
}

export const getFoodHistories = unstable_cache(loadFoodHistories, ["pantry-food-histories"], {
  revalidate: FOOD_DATA_CACHE_SECONDS,
  tags: [FOOD_DATA_CACHE_TAG],
});

async function loadLastReceiptDate() {
  const [row] = await db
    .select({ date: sql<string | null>`max(substr(${schema.receipts.purchasedAt}, 1, 10))` })
    .from(schema.receipts)
    .where(sql`${schema.receipts.purchasedAt} <= date('now', '+1 day')`);
  return row?.date ?? null;
}

export const getLastReceiptDate = unstable_cache(loadLastReceiptDate, ["pantry-last-receipt"], {
  revalidate: FOOD_DATA_CACHE_SECONDS,
  tags: [FOOD_DATA_CACHE_TAG],
});

export type RecentHaul = {
  receiptId: number;
  vendor: string | null;
  date: string;
  total: number | null;
  items: { name: string; emoji: string | null; imageUrl: string | null; slug: string | null; kind: string | null }[];
};

async function loadRecentHauls(limit: number): Promise<RecentHaul[]> {
  const receipts = await db
    .select({
      id: schema.receipts.id,
      vendor: schema.receipts.vendor,
      date: schema.receipts.purchasedAt,
      total: schema.receipts.total,
    })
    .from(schema.receipts)
    .where(sql`${schema.receipts.purchasedAt} <= date('now', '+1 day')`)
    .orderBy(desc(schema.receipts.purchasedAt), desc(schema.receipts.id))
    .limit(limit);
  if (receipts.length === 0) return [];

  const items = await db
    .select({
      receiptId: schema.lineItems.receiptId,
      rawName: schema.lineItems.rawName,
      foodName: schema.foods.name,
      emoji: schema.foods.emoji,
      imageUrl: schema.foods.imageUrl,
      slug: schema.foods.slug,
      kind: schema.foods.kind,
    })
    .from(schema.lineItems)
    .leftJoin(schema.productCatalog, eq(schema.productCatalog.id, schema.lineItems.productId))
    .leftJoin(schema.foods, eq(schema.foods.id, schema.productCatalog.foodId))
    .where(
      sql`${schema.lineItems.receiptId} in (${sql.join(
        receipts.map((r) => sql`${r.id}`),
        sql`, `,
      )})`,
    );

  return receipts.map((r) => ({
    receiptId: r.id,
    vendor: r.vendor,
    date: r.date?.slice(0, 10) ?? "",
    total: r.total,
    items: items
      .filter((i) => i.receiptId === r.id)
      .map((i) => ({ name: i.foodName ?? i.rawName, emoji: i.emoji, imageUrl: i.imageUrl, slug: i.slug, kind: i.kind })),
  }));
}

export const getRecentHauls = unstable_cache(loadRecentHauls, ["pantry-recent-hauls"], {
  revalidate: FOOD_DATA_CACHE_SECONDS,
  tags: [FOOD_DATA_CACHE_TAG],
});

export async function getFoodHistory(slug: string) {
  const histories = await getFoodHistories();
  return histories.find((h) => h.food.slug === slug) ?? null;
}
