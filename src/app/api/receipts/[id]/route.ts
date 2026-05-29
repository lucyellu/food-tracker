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

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const receiptId = Number(id);
  if (!Number.isFinite(receiptId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  await db.delete(schema.receipts).where(eq(schema.receipts.id, receiptId));
  return NextResponse.json({ ok: true });
}
