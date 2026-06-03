import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { revalidateFoodDataCache } from "@/lib/food-data-cache";
import { enrichReceiptNutrition } from "@/lib/nutrition/usda";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const receiptId = Number(id);
  if (!Number.isFinite(receiptId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const receipt = await db.query.receipts.findFirst({
    where: eq(schema.receipts.id, receiptId),
  });
  if (!receipt) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const result = await enrichReceiptNutrition(receiptId);
    revalidateFoodDataCache();
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("nutrition enrichment error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
