import { NextRequest, NextResponse } from "next/server";
import { eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { categorizeItem } from "@/lib/products/category";
import { syncProductCatalogMetadata } from "@/lib/products/catalog";

export const runtime = "nodejs";

// Backfills item categories for existing receipts using the keyword heuristic.
// Idempotent: only touches line items whose category is null, unless ?force=1.
export async function POST(req: NextRequest) {
  const force = new URL(req.url).searchParams.get("force") === "1";

  const rows = await db
    .select({
      id: schema.lineItems.id,
      rawName: schema.lineItems.rawName,
      unit: schema.lineItems.unit,
      productId: schema.lineItems.productId,
      activeIngredientsJson: schema.nutritionFacts.activeIngredientsJson,
    })
    .from(schema.lineItems)
    .leftJoin(
      schema.nutritionFacts,
      eq(schema.nutritionFacts.lineItemId, schema.lineItems.id),
    )
    .where(force ? undefined : isNull(schema.lineItems.category));

  let updated = 0;
  for (const row of rows) {
    const hasActiveIngredients = Boolean(
      row.activeIngredientsJson && row.activeIngredientsJson !== "{}",
    );
    const category = categorizeItem({
      rawName: row.rawName,
      unit: row.unit,
      hasActiveIngredients,
    });

    await db
      .update(schema.lineItems)
      .set({ category })
      .where(eq(schema.lineItems.id, row.id));
    if (row.productId) await syncProductCatalogMetadata(row.productId, { category });
    updated += 1;
  }

  return NextResponse.json({ scanned: rows.length, updated });
}
