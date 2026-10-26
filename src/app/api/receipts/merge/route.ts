import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { revalidateFoodDataCache } from "@/lib/food-data-cache";

export const runtime = "nodejs";

// Consolidates duplicate receipts into one: moves the chosen line items onto the kept receipt, optionally
// sets its total, then deletes the other receipts (their remaining line items cascade).
export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    keepId?: number;
    dropIds?: number[];
    moveItemIds?: number[];
    total?: number | null;
  };
  const keepId = Number(body.keepId);
  const dropIds = (body.dropIds ?? []).map(Number).filter((id) => Number.isFinite(id) && id !== keepId);
  if (!Number.isFinite(keepId) || dropIds.length === 0) {
    return NextResponse.json({ error: "keepId and at least one other receipt are required" }, { status: 400 });
  }
  const moveItemIds = (body.moveItemIds ?? []).map(Number).filter(Number.isFinite);

  const keep = await db.query.receipts.findFirst({ where: eq(schema.receipts.id, keepId) });
  if (!keep) return NextResponse.json({ error: "Receipt to keep not found" }, { status: 404 });

  if (moveItemIds.length > 0) {
    // Only items that really belong to a receipt being merged can be moved.
    await db
      .update(schema.lineItems)
      .set({ receiptId: keepId })
      .where(and(inArray(schema.lineItems.id, moveItemIds), inArray(schema.lineItems.receiptId, dropIds)));
  }
  if (body.total !== undefined) {
    const total = body.total == null ? null : Number(body.total);
    if (total != null && (!Number.isFinite(total) || total < 0)) {
      return NextResponse.json({ error: "total must be a number >= 0" }, { status: 400 });
    }
    await db.update(schema.receipts).set({ total }).where(eq(schema.receipts.id, keepId));
  }
  await db.delete(schema.receipts).where(inArray(schema.receipts.id, dropIds));

  revalidateFoodDataCache();
  return NextResponse.json({ ok: true });
}
