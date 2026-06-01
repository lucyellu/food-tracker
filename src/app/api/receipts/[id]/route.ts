import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { mergeCatalogFieldsIntoLineItem } from "@/lib/products/catalog";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const receiptId = Number(id);
  if (!Number.isFinite(receiptId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const receipt = await db.query.receipts.findFirst({
    where: eq(schema.receipts.id, receiptId),
  });
  if (!receipt) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const rows = await db
    .select({
      item: schema.lineItems,
      product: schema.productCatalog,
    })
    .from(schema.lineItems)
    .leftJoin(schema.productCatalog, eq(schema.productCatalog.id, schema.lineItems.productId))
    .where(eq(schema.lineItems.receiptId, receiptId));
  const items = rows.map((row) => mergeCatalogFieldsIntoLineItem(row.item, row.product));

  return NextResponse.json({ receipt, items });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const receiptId = Number(id);
  if (!Number.isFinite(receiptId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const body = (await req.json()) as {
    vendor?: string | null;
    purchasedAt?: string | null;
    total?: number | null;
  };

  const set: Partial<typeof schema.receipts.$inferInsert> = {};

  if ("vendor" in body) {
    const vendor = body.vendor?.trim();
    set.vendor = vendor ? vendor : null;
  }
  if ("purchasedAt" in body) {
    const value = body.purchasedAt?.trim();
    if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return NextResponse.json({ error: "purchasedAt must be YYYY-MM-DD" }, { status: 400 });
    }
    set.purchasedAt = value ? value : null;
  }
  if ("total" in body) {
    if (body.total == null) {
      set.total = null;
    } else {
      const total = Number(body.total);
      if (!Number.isFinite(total) || total < 0) {
        return NextResponse.json({ error: "total must be a number >= 0" }, { status: 400 });
      }
      set.total = total;
    }
  }

  if (Object.keys(set).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const [updated] = await db
    .update(schema.receipts)
    .set(set)
    .where(eq(schema.receipts.id, receiptId))
    .returning();
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ receipt: updated });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const receiptId = Number(id);
  if (!Number.isFinite(receiptId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  await db.delete(schema.receipts).where(eq(schema.receipts.id, receiptId));
  return NextResponse.json({ ok: true });
}
