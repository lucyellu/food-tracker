import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { linkLineItemToCatalog } from "@/lib/products/catalog";
import { isCategory } from "@/lib/products/category";

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

function parseIds(idValue: string, itemIdValue: string) {
  const receiptId = Number(idValue);
  const itemId = Number(itemIdValue);
  if (!Number.isFinite(receiptId) || !Number.isFinite(itemId)) return null;
  return { receiptId, itemId };
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; itemId: string }> },
) {
  const { id, itemId: itemIdParam } = await ctx.params;
  const ids = parseIds(id, itemIdParam);
  if (!ids) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  const { receiptId, itemId } = ids;

  const body = (await req.json()) as {
    rawName?: string;
    quantity?: number;
    unit?: string;
    price?: number | null;
    category?: string | null;
    consumptionStatus?: string;
    statusDate?: string | null;
  };

  const set: Partial<typeof schema.lineItems.$inferInsert> = {};

  if ("rawName" in body) {
    const rawName = body.rawName?.trim();
    if (!rawName) return NextResponse.json({ error: "rawName cannot be empty" }, { status: 400 });
    set.rawName = rawName;
  }
  if ("quantity" in body) {
    const quantity = Number(body.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return NextResponse.json({ error: "quantity must be > 0" }, { status: 400 });
    }
    set.quantity = quantity;
  }
  if ("unit" in body && typeof body.unit === "string" && body.unit.trim()) {
    set.unit = body.unit.trim();
  }
  if ("price" in body) {
    if (body.price == null) {
      set.price = null;
    } else {
      const price = Number(body.price);
      if (!Number.isFinite(price) || price < 0) {
        return NextResponse.json({ error: "price must be a number >= 0" }, { status: 400 });
      }
      set.price = price;
    }
  }
  if ("category" in body) {
    if (body.category == null) set.category = null;
    else if (isCategory(body.category)) set.category = body.category;
    else return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  }
  if ("consumptionStatus" in body) {
    if (!body.consumptionStatus || !STATUS.has(body.consumptionStatus)) {
      return NextResponse.json({ error: "Invalid consumptionStatus" }, { status: 400 });
    }
    set.consumptionStatus =
      body.consumptionStatus as typeof schema.lineItems.$inferInsert.consumptionStatus;
  }
  if ("statusDate" in body) {
    set.statusDate =
      typeof body.statusDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.statusDate)
        ? body.statusDate
        : null;
  }

  if (Object.keys(set).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const [updated] = await db
    .update(schema.lineItems)
    .set(set)
    .where(and(eq(schema.lineItems.receiptId, receiptId), eq(schema.lineItems.id, itemId)))
    .returning();
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Re-link to the product catalog so a renamed/recategorized item points at the
  // right product (and the product carries the new category).
  if ("rawName" in set || "category" in set) {
    const receipt = await db.query.receipts.findFirst({
      where: eq(schema.receipts.id, receiptId),
    });
    await linkLineItemToCatalog(updated, receipt?.vendor ?? null);
  }

  return NextResponse.json({ item: updated });
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; itemId: string }> },
) {
  const { id, itemId: itemIdParam } = await ctx.params;
  const ids = parseIds(id, itemIdParam);
  if (!ids) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  const { receiptId, itemId } = ids;

  const deleted = await db
    .delete(schema.lineItems)
    .where(and(eq(schema.lineItems.receiptId, receiptId), eq(schema.lineItems.id, itemId)))
    .returning({ id: schema.lineItems.id });

  if (deleted.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
