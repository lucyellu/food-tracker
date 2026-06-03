import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { revalidateFoodDataCache } from "@/lib/food-data-cache";

export const runtime = "nodejs";

const LOG_UNITS = new Set(["item", "serving", "g", "100g"]);

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const receiptId = Number(id);
  if (!Number.isFinite(receiptId)) {
    return NextResponse.json({ error: "Invalid receipt id" }, { status: 400 });
  }

  const body = (await req.json()) as {
    lineItemId?: number;
    consumedAt?: string;
    amount?: number;
    unit?: string;
    note?: string | null;
  };
  const lineItemId = Number(body.lineItemId);
  const amount = Number(body.amount);
  if (!Number.isFinite(lineItemId)) {
    return NextResponse.json({ error: "Invalid line item id" }, { status: 400 });
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "Amount must be greater than zero" }, { status: 400 });
  }
  if (!body.unit || !LOG_UNITS.has(body.unit)) {
    return NextResponse.json({ error: "Invalid unit" }, { status: 400 });
  }
  if (!body.consumedAt || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(body.consumedAt)) {
    return NextResponse.json({ error: "Invalid consumed timestamp" }, { status: 400 });
  }

  const item = await db.query.lineItems.findFirst({
    where: and(eq(schema.lineItems.id, lineItemId), eq(schema.lineItems.receiptId, receiptId)),
  });
  if (!item) {
    return NextResponse.json({ error: "Line item not found for receipt" }, { status: 404 });
  }

  const [log] = await db
    .insert(schema.consumptionLogs)
    .values({
      receiptId,
      lineItemId,
      consumedAt: body.consumedAt,
      amount,
      unit: body.unit as typeof schema.consumptionLogs.$inferInsert.unit,
      note: body.note?.trim() || null,
    })
    .returning();

  revalidateFoodDataCache();
  return NextResponse.json({ log });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const receiptId = Number(id);
  if (!Number.isFinite(receiptId)) {
    return NextResponse.json({ error: "Invalid receipt id" }, { status: 400 });
  }

  const body = (await req.json()) as { logId?: number };
  const logId = Number(body.logId);
  if (!Number.isFinite(logId)) {
    return NextResponse.json({ error: "Invalid log id" }, { status: 400 });
  }

  const rows = await db
    .delete(schema.consumptionLogs)
    .where(and(eq(schema.consumptionLogs.id, logId), eq(schema.consumptionLogs.receiptId, receiptId)))
    .returning({ id: schema.consumptionLogs.id });

  if (rows.length > 0) revalidateFoodDataCache();
  return NextResponse.json({ deleted: rows.length });
}
