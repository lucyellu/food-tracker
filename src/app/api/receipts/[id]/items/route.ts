import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db/client";

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
