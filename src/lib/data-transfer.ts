import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db/client";

export const DATA_EXPORT_VERSION = 3;

type ReceiptRow = typeof schema.receipts.$inferSelect;
type ProductRow = typeof schema.productCatalog.$inferSelect;
type LineItemRow = typeof schema.lineItems.$inferSelect;
type NutritionRow = typeof schema.nutritionFacts.$inferSelect;
type ConsumptionLogRow = typeof schema.consumptionLogs.$inferSelect;
type SettingsRow = typeof schema.settings.$inferSelect;

type ImportableSettings = Pick<SettingsRow, "people" | "days">;

type DataExport = {
  version: number;
  exportedAt: string;
  productCatalog: ProductRow[];
  receipts: ReceiptRow[];
  lineItems: LineItemRow[];
  nutritionFacts: NutritionRow[];
  consumptionLogs: ConsumptionLogRow[];
  settings: ImportableSettings | null;
};

const RECEIPT_SOURCES = new Set(["manual_text", "manual_image", "manual_email_paste", "auto_email", "google_photos"]);
const RAW_INPUT_KINDS = new Set(["text", "image", "email"]);
const PARSE_STATUSES = new Set(["pending", "parsed", "failed"]);
const ITEM_STATUSES = new Set(["available", "pantry", "fridge", "consumed", "disposed", "unavailable", "refunded"]);
const NUTRITION_STATUSES = new Set(["pending", "matched", "unmatched", "manual"]);
const LOG_UNITS = new Set(["item", "serving", "g", "100g"]);
const MAX_REASONABLE_LINE_GRAMS = 100_000;
const MAX_REASONABLE_LINE_CALORIES = 100_000;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function asInteger(value: unknown) {
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

function asDateString(value: unknown) {
  const text = asString(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : text;
}

function pickEnum<T extends string>(value: unknown, allowed: Set<string>, fallback: T) {
  return typeof value === "string" && allowed.has(value) ? (value as T) : fallback;
}

function receiptSignature(receipt: Pick<ReceiptRow, "vendor" | "purchasedAt" | "total" | "rawInputKind">, items: LineItemRow[]) {
  const itemKey = items
    .map((item) =>
      [
        item.rawName.toLowerCase().replace(/\s+/g, " ").trim(),
        item.quantity,
        item.unit,
        item.price ?? "",
        item.retailerSku ?? "",
      ].join(":"),
    )
    .slice(0, 12)
    .join("|");
  return [
    receipt.vendor?.toLowerCase().replace(/\s+/g, " ").trim() ?? "",
    receipt.purchasedAt ?? "",
    receipt.total ?? "",
    receipt.rawInputKind,
    itemKey,
  ].join("::");
}

function groupByReceipt(items: LineItemRow[]) {
  const byReceipt = new Map<number, LineItemRow[]>();
  for (const item of items) {
    byReceipt.set(item.receiptId, [...(byReceipt.get(item.receiptId) ?? []), item]);
  }
  return byReceipt;
}

function groupByLineItem<T extends { lineItemId: number }>(rows: T[]) {
  const byLineItem = new Map<number, T>();
  for (const row of rows) byLineItem.set(row.lineItemId, row);
  return byLineItem;
}

function logsByReceipt(logs: ConsumptionLogRow[]) {
  const byReceipt = new Map<number, ConsumptionLogRow[]>();
  for (const log of logs) {
    byReceipt.set(log.receiptId, [...(byReceipt.get(log.receiptId) ?? []), log]);
  }
  return byReceipt;
}

export async function exportFoodTrackerData(): Promise<DataExport> {
  const [productCatalog, receipts, lineItems, nutritionFacts, consumptionLogs, settingsRows] = await Promise.all([
    db.select().from(schema.productCatalog).orderBy(asc(schema.productCatalog.id)),
    db.select().from(schema.receipts).orderBy(asc(schema.receipts.id)),
    db.select().from(schema.lineItems).orderBy(asc(schema.lineItems.id)),
    db.select().from(schema.nutritionFacts).orderBy(asc(schema.nutritionFacts.lineItemId)),
    db.select().from(schema.consumptionLogs).orderBy(asc(schema.consumptionLogs.id)),
    db.select().from(schema.settings).where(eq(schema.settings.id, 1)).limit(1),
  ]);

  const settings = settingsRows[0] ? { people: settingsRows[0].people, days: settingsRows[0].days } : null;

  return {
    version: DATA_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    productCatalog,
    receipts,
    lineItems,
    nutritionFacts,
    consumptionLogs,
    settings,
  };
}

export async function importFoodTrackerData(input: unknown) {
  const payload = asRecord(input);
  if (!payload) throw new Error("Import file must be a JSON object.");

  const incomingProducts = Array.isArray(payload.productCatalog) ? payload.productCatalog : [];
  const incomingReceipts = Array.isArray(payload.receipts) ? payload.receipts : [];
  const incomingItems = Array.isArray(payload.lineItems) ? payload.lineItems : [];
  const incomingNutrition = Array.isArray(payload.nutritionFacts) ? payload.nutritionFacts : [];
  const incomingLogs = Array.isArray(payload.consumptionLogs) ? payload.consumptionLogs : [];
  const incomingSettings = asRecord(payload.settings);

  const [existingReceipts, existingItems] = await Promise.all([
    db.select().from(schema.receipts).orderBy(asc(schema.receipts.id)),
    db.select().from(schema.lineItems).orderBy(asc(schema.lineItems.id)),
  ]);
  const existingByMessage = new Set(existingReceipts.map((receipt) => receipt.sourceMessageId).filter(Boolean));
  const existingItemsByReceipt = groupByReceipt(existingItems);
  const existingSignatures = new Set(
    existingReceipts.map((receipt) => receiptSignature(receipt, existingItemsByReceipt.get(receipt.id) ?? [])),
  );

  const importedReceiptIds = new Map<number, number>();
  const importedProductIds = new Map<number, number>();
  const importedItemIds = new Map<number, number>();
  const sourceItemsByReceipt = groupByReceipt(incomingItems.map(normalizeLineItem).filter(Boolean) as LineItemRow[]);
  const nutritionByItem = groupByLineItem(incomingNutrition.map(normalizeNutrition).filter(Boolean) as NutritionRow[]);
  const sourceLogsByReceipt = logsByReceipt(incomingLogs.map(normalizeLog).filter(Boolean) as ConsumptionLogRow[]);

  let importedProducts = 0;
  let importedReceipts = 0;
  let skippedReceipts = 0;
  let importedItems = 0;
  let importedNutritionFacts = 0;
  let importedLogs = 0;

  for (const raw of incomingProducts) {
    const product = normalizeProduct(raw);
    if (!product) continue;
    const [createdProduct] = await db
      .insert(schema.productCatalog)
      .values({
        productKey: product.productKey,
        displayName: product.displayName,
        normalizedName: product.normalizedName,
        category: product.category,
        brand: product.brand,
        barcode: product.barcode,
        externalSource: product.externalSource,
        externalId: product.externalId,
        retailerSku: product.retailerSku,
        productSource: product.productSource,
        productUrl: product.productUrl,
        productImageUrl: product.productImageUrl,
        fdcId: product.fdcId,
      })
      .onConflictDoUpdate({
        target: schema.productCatalog.productKey,
        set: {
          displayName: product.displayName,
          normalizedName: product.normalizedName,
          category: product.category,
          brand: product.brand,
          barcode: product.barcode,
          externalSource: product.externalSource,
          externalId: product.externalId,
          retailerSku: product.retailerSku,
          productSource: product.productSource,
          productUrl: product.productUrl,
          productImageUrl: product.productImageUrl,
          fdcId: product.fdcId,
          updatedAt: new Date(),
        },
      })
      .returning();
    importedProductIds.set(product.id, createdProduct.id);
    importedProducts += 1;
  }

  for (const raw of incomingReceipts) {
    const receipt = normalizeReceipt(raw);
    if (!receipt) continue;
    const sourceItems = sourceItemsByReceipt.get(receipt.id) ?? [];
    const signature = receiptSignature(receipt, sourceItems);
    if ((receipt.sourceMessageId && existingByMessage.has(receipt.sourceMessageId)) || existingSignatures.has(signature)) {
      skippedReceipts += 1;
      continue;
    }

    const [createdReceipt] = await db
      .insert(schema.receipts)
      .values({
        vendor: receipt.vendor,
        purchasedAt: receipt.purchasedAt,
        total: receipt.total,
        source: receipt.source,
        sourceMessageId: receipt.sourceMessageId,
        rawInputKind: receipt.rawInputKind,
        rawInputRef: receipt.rawInputRef,
        parseStatus: receipt.parseStatus,
        parseError: receipt.parseError,
      })
      .returning();

    importedReceipts += 1;
    importedReceiptIds.set(receipt.id, createdReceipt.id);
    if (createdReceipt.sourceMessageId) existingByMessage.add(createdReceipt.sourceMessageId);
    existingSignatures.add(signature);

    for (const item of sourceItems) {
      const [createdItem] = await db
        .insert(schema.lineItems)
        .values({
          receiptId: createdReceipt.id,
          productId: item.productId ? importedProductIds.get(item.productId) ?? null : null,
          rawName: item.rawName,
          normalizedName: item.normalizedName,
          category: item.category,
          brand: item.brand,
          quantity: item.quantity,
          unit: item.unit,
          price: item.price,
          retailerSku: item.retailerSku,
          productSource: item.productSource,
          productUrl: item.productUrl,
          productImageUrl: item.productImageUrl,
          consumptionStatus: item.consumptionStatus,
          statusDate: item.statusDate,
          autoConsumed: item.autoConsumed,
          fdcId: item.fdcId,
          nutritionStatus: item.nutritionStatus,
        })
        .returning();

      importedItems += 1;
      importedItemIds.set(item.id, createdItem.id);

      const nutrition = nutritionByItem.get(item.id);
      if (nutrition) {
        await db.insert(schema.nutritionFacts).values({
          lineItemId: createdItem.id,
          totalGrams: nutrition.totalGrams,
          calories: nutrition.calories,
          proteinG: nutrition.proteinG,
          carbsG: nutrition.carbsG,
          fatG: nutrition.fatG,
          fiberG: nutrition.fiberG,
          sugarG: nutrition.sugarG,
          sodiumMg: nutrition.sodiumMg,
          alcoholG: nutrition.alcoholG,
          caffeineMg: nutrition.caffeineMg,
          vitaminsJson: nutrition.vitaminsJson,
          mineralsJson: nutrition.mineralsJson,
          ingredientsText: nutrition.ingredientsText,
          activeIngredientsJson: nutrition.activeIngredientsJson,
        });
        importedNutritionFacts += 1;
      }
    }

    for (const log of sourceLogsByReceipt.get(receipt.id) ?? []) {
      const lineItemId = importedItemIds.get(log.lineItemId);
      const receiptId = importedReceiptIds.get(log.receiptId);
      if (!lineItemId || !receiptId) continue;
      await db.insert(schema.consumptionLogs).values({
        receiptId,
        lineItemId,
        consumedAt: log.consumedAt,
        amount: log.amount,
        unit: log.unit,
        note: log.note,
      });
      importedLogs += 1;
    }
  }

  let importedSettings = false;
  if (incomingSettings) {
    const people = asInteger(incomingSettings.people);
    const days = asInteger(incomingSettings.days);
    if (people && people > 0 && days && days > 0) {
      await db
        .insert(schema.settings)
        .values({ id: 1, people, days })
        .onConflictDoUpdate({
          target: schema.settings.id,
          set: { people, days },
        });
      importedSettings = true;
    }
  }

  return {
    importedReceipts,
    importedProducts,
    skippedReceipts,
    importedItems,
    importedNutritionFacts,
    importedLogs,
    importedSettings,
  };
}

function normalizeReceipt(value: unknown): ReceiptRow | null {
  const row = asRecord(value);
  const id = asInteger(row?.id);
  const rawNameKind = pickEnum(row?.rawInputKind, RAW_INPUT_KINDS, "text");
  if (!row || !id) return null;
  return {
    id,
    vendor: asString(row.vendor),
    purchasedAt: asString(row.purchasedAt),
    total: asNumber(row.total),
    source: pickEnum(row.source, RECEIPT_SOURCES, "manual_text"),
    sourceMessageId: asString(row.sourceMessageId),
    rawInputKind: rawNameKind,
    rawInputRef: asString(row.rawInputRef),
    parseStatus: pickEnum(row.parseStatus, PARSE_STATUSES, "parsed"),
    parseError: asString(row.parseError),
    createdAt: new Date(asDateString(row.createdAt) ?? Date.now()),
  };
}

function normalizeProduct(value: unknown): ProductRow | null {
  const row = asRecord(value);
  const id = asInteger(row?.id);
  const productKey = asString(row?.productKey);
  const displayName = asString(row?.displayName);
  if (!row || !id || !productKey || !displayName) return null;
  return {
    id,
    productKey,
    displayName,
    normalizedName: asString(row.normalizedName),
    category: asString(row.category),
    brand: asString(row.brand),
    barcode: asString(row.barcode),
    externalSource: asString(row.externalSource),
    externalId: asString(row.externalId),
    retailerSku: asString(row.retailerSku),
    productSource: asString(row.productSource),
    productUrl: asString(row.productUrl),
    productImageUrl: asString(row.productImageUrl),
    fdcId: asInteger(row.fdcId),
    firstSeenAt: new Date(asDateString(row.firstSeenAt) ?? Date.now()),
    updatedAt: new Date(asDateString(row.updatedAt) ?? Date.now()),
  };
}

function normalizeLineItem(value: unknown): LineItemRow | null {
  const row = asRecord(value);
  const id = asInteger(row?.id);
  const receiptId = asInteger(row?.receiptId);
  const rawName = asString(row?.rawName);
  if (!row || !id || !receiptId || !rawName) return null;
  return {
    id,
    receiptId,
    productId: asInteger(row.productId),
    rawName,
    normalizedName: asString(row.normalizedName),
    category: asString(row.category),
    brand: asString(row.brand),
    quantity: asNumber(row.quantity) ?? 1,
    unit: asString(row.unit) ?? "count",
    price: asNumber(row.price),
    retailerSku: asString(row.retailerSku),
    productSource: asString(row.productSource),
    productUrl: asString(row.productUrl),
    productImageUrl: asString(row.productImageUrl),
    consumptionStatus: pickEnum(row.consumptionStatus, ITEM_STATUSES, "available"),
    statusDate: asString(row.statusDate),
    autoConsumed: Boolean(row.autoConsumed),
    fdcId: asInteger(row.fdcId),
    nutritionStatus: pickEnum(row.nutritionStatus, NUTRITION_STATUSES, "pending"),
  };
}

function normalizeNutrition(value: unknown): NutritionRow | null {
  const row = asRecord(value);
  const lineItemId = asInteger(row?.lineItemId);
  if (!row || !lineItemId) return null;
  const totalGrams = asNumber(row.totalGrams);
  const calories = asNumber(row.calories);
  const proteinG = asNumber(row.proteinG);
  const carbsG = asNumber(row.carbsG);
  const fatG = asNumber(row.fatG);
  if (
    (totalGrams ?? 0) > MAX_REASONABLE_LINE_GRAMS ||
    (calories ?? 0) > MAX_REASONABLE_LINE_CALORIES ||
    (proteinG ?? 0) > MAX_REASONABLE_LINE_GRAMS ||
    (carbsG ?? 0) > MAX_REASONABLE_LINE_GRAMS ||
    (fatG ?? 0) > MAX_REASONABLE_LINE_GRAMS
  ) {
    return null;
  }
  return {
    lineItemId,
    totalGrams,
    calories,
    proteinG,
    carbsG,
    fatG,
    fiberG: asNumber(row.fiberG),
    sugarG: asNumber(row.sugarG),
    sodiumMg: asNumber(row.sodiumMg),
    alcoholG: asNumber(row.alcoholG),
    caffeineMg: asNumber(row.caffeineMg),
    vitaminsJson: asString(row.vitaminsJson),
    mineralsJson: asString(row.mineralsJson),
    ingredientsText: asString(row.ingredientsText),
    activeIngredientsJson: asString(row.activeIngredientsJson),
  };
}

function normalizeLog(value: unknown): ConsumptionLogRow | null {
  const row = asRecord(value);
  const id = asInteger(row?.id);
  const receiptId = asInteger(row?.receiptId);
  const lineItemId = asInteger(row?.lineItemId);
  const consumedAt = asString(row?.consumedAt);
  if (!row || !id || !receiptId || !lineItemId || !consumedAt) return null;
  return {
    id,
    receiptId,
    lineItemId,
    consumedAt,
    amount: asNumber(row.amount) ?? 1,
    unit: pickEnum(row.unit, LOG_UNITS, "serving"),
    note: asString(row.note),
    createdAt: new Date(asDateString(row.createdAt) ?? Date.now()),
  };
}
