import { db, schema } from "@/db/client";
import type { ParsedReceipt } from "@/lib/llm/schema";
import {
  getOrCreateCatalogProductForLineItem,
  productCatalogKey,
} from "@/lib/products/catalog";
import { cannabisNutritionForParsedItem } from "@/lib/receipts/cannabis";
import { categorizeItem } from "@/lib/products/category";
import { resolveReceiptPurchasedDate } from "@/lib/receipts/dates";
import { enrichReceiptNutrition } from "@/lib/nutrition/usda";
import { canonicalizeProducts } from "@/lib/foods/canonicalize";

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
    const categories = parsed.items.map((it, index) =>
      it.category ??
      categorizeItem({
        rawName: it.raw_name,
        unit: it.unit,
        hasActiveIngredients: Boolean(cannabisNutrition[index]),
      }),
    );
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
          category: categories[index],
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
        category: categories[index],
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
    
    // Automatically trigger USDA enrichment so the user doesn't have to click a button manually.
    // It utilizes the local cache, so this is fast for repeated items.
    await enrichReceiptNutrition(receipt.id).catch(err => {
      console.error("Auto-nutrition enrich failed for receipt", receipt.id, err);
    });

    // Group new products into canonical foods so they show up in the pantry.
    const productIds = [...new Set(products.flatMap((p) => (p?.id ? [p.id] : [])))];
    if (productIds.length > 0) {
      await canonicalizeProducts({ productIds, limit: productIds.length }).catch((err) => {
        console.error("Food canonicalize failed for receipt", receipt.id, err);
      });
    }
  }

  return receipt;
}
