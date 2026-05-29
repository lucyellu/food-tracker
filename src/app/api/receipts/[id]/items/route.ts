import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { getOrCreateCatalogProductForLineItem } from "@/lib/products/catalog";

export const runtime = "nodejs";

const STATUS = new Set([
  "available",
  "pantry",
  "fridge",
  "consumed",
  "disposed",
  "unavailable",
  "refunded",
]);
const CUSTOM_ENTRY_TYPES = new Set(["caffeine", "alcohol", "cannabis", "medication", "other"]);

function finiteOrNull(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const receiptId = Number(id);
  if (!Number.isFinite(receiptId)) {
    return NextResponse.json({ error: "Invalid receipt id" }, { status: 400 });
  }

  const body = (await req.json()) as {
    name?: string;
    entryType?: string;
    consumedAt?: string;
    note?: string | null;
    price?: number | null;
    caffeineMg?: number | null;
    alcoholG?: number | null;
    thcMg?: number | null;
    cbdMg?: number | null;
    cbnMg?: number | null;
    cbgMg?: number | null;
    amphetamineMg?: number | null;
  };
  const name = body.name?.trim();
  const entryType = body.entryType && CUSTOM_ENTRY_TYPES.has(body.entryType) ? body.entryType : "other";
  const consumedAt =
    body.consumedAt && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(body.consumedAt)
      ? body.consumedAt
      : new Date().toISOString().slice(0, 16);
  if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });

  const receipt = await db.query.receipts.findFirst({
    where: eq(schema.receipts.id, receiptId),
  });
  if (!receipt) return NextResponse.json({ error: "Receipt not found" }, { status: 404 });

  const active = {
    caffeineMg: finiteOrNull(body.caffeineMg),
    alcoholG: finiteOrNull(body.alcoholG),
    thcMg: finiteOrNull(body.thcMg),
    cbdMg: finiteOrNull(body.cbdMg),
    cbnMg: finiteOrNull(body.cbnMg),
    cbgMg: finiteOrNull(body.cbgMg),
    amphetamineMg: finiteOrNull(body.amphetamineMg),
  };
  const hasAnyAmount = Object.values(active).some((value) => value != null);
  if (!hasAnyAmount) {
    return NextResponse.json({ error: "At least one tracked amount is required" }, { status: 400 });
  }

  const product = await getOrCreateCatalogProductForLineItem({
    vendor: receipt.vendor ?? "manual",
    rawName: name,
    normalizedName: name,
    productSource: "Manual",
  });

  const [item] = await db
    .insert(schema.lineItems)
    .values({
      receiptId,
      productId: product?.id ?? null,
      rawName: name,
      normalizedName: name,
      quantity: 1,
      unit: entryType,
      price: finiteOrNull(body.price),
      nutritionStatus: "manual",
      consumptionStatus: "consumed",
      statusDate: consumedAt.slice(0, 10),
      productSource: "Manual",
    })
    .returning();

  const activeIngredientsJson = JSON.stringify({
    source: "manual",
    basis: "manual_entry",
    entryType,
    active,
  });

  const [nutrition] = await db
    .insert(schema.nutritionFacts)
    .values({
      lineItemId: item.id,
      alcoholG: active.alcoholG,
      caffeineMg: active.caffeineMg,
      vitaminsJson: "{}",
      mineralsJson: "{}",
      activeIngredientsJson,
    })
    .returning();

  const [log] = await db
    .insert(schema.consumptionLogs)
    .values({
      receiptId,
      lineItemId: item.id,
      consumedAt,
      amount: 1,
      unit: "serving",
      note: body.note?.trim() || `${entryType} entry`,
    })
    .returning();

  return NextResponse.json({ item: { ...item, nutrition }, log });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const receiptId = Number(id);
  if (!Number.isFinite(receiptId)) {
    return NextResponse.json({ error: "Invalid receipt id" }, { status: 400 });
  }

  const body = (await req.json()) as { itemIds?: number[]; status?: string; statusDate?: string | null };
  const itemIds = Array.isArray(body.itemIds)
    ? body.itemIds.filter((itemId) => Number.isFinite(itemId))
    : [];
  if (itemIds.length === 0) {
    return NextResponse.json({ error: "No item ids provided" }, { status: 400 });
  }
  if (!body.status || !STATUS.has(body.status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }
  const statusDate =
    typeof body.statusDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.statusDate)
      ? body.statusDate
      : null;

  const rows = await db
    .update(schema.lineItems)
    .set({
      consumptionStatus: body.status as typeof schema.lineItems.$inferInsert.consumptionStatus,
      statusDate,
    })
    .where(
      and(
        eq(schema.lineItems.receiptId, receiptId),
        inArray(schema.lineItems.id, itemIds),
      ),
    )
    .returning({ id: schema.lineItems.id });

  return NextResponse.json({ updated: rows.length });
}
