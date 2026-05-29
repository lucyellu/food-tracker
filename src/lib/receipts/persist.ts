import { db, schema } from "@/db/client";
import type { ParsedReceipt } from "@/lib/llm/schema";
import {
  getOrCreateCatalogProductForLineItem,
  productCatalogKey,
} from "@/lib/products/catalog";
import { cannabisNutritionForParsedItem } from "@/lib/receipts/cannabis";
import { resolveReceiptPurchasedDate } from "@/lib/receipts/dates";

type PersistReceiptInput = {
  parsed: ParsedReceipt;
  source: typeof schema.receipts.$inferInsert.source;
  rawInputKind: typeof schema.receipts.$inferInsert.rawInputKind;
  rawInputRef: string | null;
  sourceMessageId?: string | null;
};

export async function persistParsedReceipt({
  parsed,
  source,
  rawInputKind,
  rawInputRef,
  sourceMessageId = null,
}: PersistReceiptInput) {
  const purchasedAt = resolveReceiptPurchasedDate(parsed.purchased_at, rawInputRef);
  const [receipt] = await db
    .insert(schema.receipts)
    .values({
      vendor: parsed.vendor,
      purchasedAt,
      total: parsed.total,
      source,
      sourceMessageId,
      rawInputKind,
      rawInputRef,
      parseStatus: "parsed",
    })
    .returning();

  if (parsed.items.length > 0) {
    const cannabisNutrition = parsed.items.map(cannabisNutritionForParsedItem);
    const productCache = new Map<
      string,
      ReturnType<typeof getOrCreateCatalogProductForLineItem>
    >();
    const products = await Promise.all(
      parsed.items.map((it, index) => {
        const key = productCatalogKey({
          vendor: parsed.vendor,
          rawName: it.raw_name,
          retailerSku: null,
        });
        if (key && productCache.has(key)) return productCache.get(key)!;
        const productRequest = getOrCreateCatalogProductForLineItem({
          vendor: parsed.vendor,
          rawName: it.raw_name,
          productSource: cannabisNutrition[index] ? "Controlled label" : null,
        });
        if (key) productCache.set(key, productRequest);
        return productRequest;
      }),
    );
    const itemRows: (typeof schema.lineItems.$inferInsert)[] = parsed.items.map((it, index) => {
      const product = products[index];
      return {
        receiptId: receipt.id,
        productId: product?.id ?? null,
        rawName: it.raw_name,
        quantity: it.quantity,
        unit: it.unit,
        price: it.price,
        nutritionStatus: cannabisNutrition[index] ? "manual" : "pending",
      };
    });
    const insertedItems = await db.insert(schema.lineItems).values(itemRows).returning();

    const nutritionRows: (typeof schema.nutritionFacts.$inferInsert)[] = [];
    insertedItems.forEach((item, index) => {
      const nutrition = cannabisNutrition[index];
      if (nutrition) nutritionRows.push({ lineItemId: item.id, ...nutrition });
    });

    if (nutritionRows.length > 0) {
      await db.insert(schema.nutritionFacts).values(nutritionRows);
    }
  }

  return receipt;
}
