import { asc, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import {
  ReceiptCalendarView,
  type CalendarItem,
  type CalendarReceipt,
} from "./ReceiptCalendarView";
import { inferPurchasedDateFromText, normalizeReceiptDate } from "@/lib/receipts/dates";

export const dynamic = "force-dynamic";

function toIso(value: Date | string | null | undefined) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function getCalendarData() {
  const [receipts, items] = await Promise.all([
    db
      .select({
        id: schema.receipts.id,
        vendor: schema.receipts.vendor,
        purchasedAt: schema.receipts.purchasedAt,
        total: schema.receipts.total,
        source: schema.receipts.source,
        rawInputRef: schema.receipts.rawInputRef,
        createdAt: schema.receipts.createdAt,
        itemCount: sql<number>`COUNT(${schema.lineItems.id})`.as("item_count"),
      })
      .from(schema.receipts)
      .leftJoin(schema.lineItems, eq(schema.lineItems.receiptId, schema.receipts.id))
      .groupBy(schema.receipts.id)
      .orderBy(desc(schema.receipts.createdAt)),
    db
      .select({
        id: schema.lineItems.id,
        receiptId: schema.lineItems.receiptId,
        rawName: schema.lineItems.rawName,
        quantity: schema.lineItems.quantity,
        unit: schema.lineItems.unit,
        price: schema.lineItems.price,
        consumptionStatus: schema.lineItems.consumptionStatus,
        statusDate: schema.lineItems.statusDate,
        receiptVendor: schema.receipts.vendor,
        receiptPurchasedAt: schema.receipts.purchasedAt,
        receiptRawInputRef: schema.receipts.rawInputRef,
        receiptCreatedAt: schema.receipts.createdAt,
        totalGrams: schema.nutritionFacts.totalGrams,
        calories: schema.nutritionFacts.calories,
        proteinG: schema.nutritionFacts.proteinG,
        carbsG: schema.nutritionFacts.carbsG,
        fatG: schema.nutritionFacts.fatG,
        alcoholG: schema.nutritionFacts.alcoholG,
        caffeineMg: schema.nutritionFacts.caffeineMg,
        activeIngredientsJson: schema.nutritionFacts.activeIngredientsJson,
      })
      .from(schema.lineItems)
      .innerJoin(schema.receipts, eq(schema.receipts.id, schema.lineItems.receiptId))
      .leftJoin(schema.nutritionFacts, eq(schema.nutritionFacts.lineItemId, schema.lineItems.id))
      .orderBy(desc(schema.receipts.createdAt), asc(schema.lineItems.id)),
  ]);

  return {
    receipts: receipts.map(
      (receipt): CalendarReceipt => ({
        id: receipt.id,
        vendor: receipt.vendor,
        purchasedAt: normalizeReceiptDate(receipt.purchasedAt) ?? inferPurchasedDateFromText(receipt.rawInputRef),
        total: receipt.total,
        source: receipt.source,
        createdAt: toIso(receipt.createdAt),
        itemCount: receipt.itemCount,
      }),
    ),
    items: items.map(
      (item): CalendarItem => ({
        id: item.id,
        receiptId: item.receiptId,
        rawName: item.rawName.replace(/^\[REFUNDED\]\s*/i, ""),
        quantity: item.quantity,
        unit: item.unit,
        price: item.price,
        consumptionStatus: item.consumptionStatus,
        statusDate: item.statusDate,
        receiptVendor: item.receiptVendor,
        receiptPurchasedAt: normalizeReceiptDate(item.receiptPurchasedAt) ?? inferPurchasedDateFromText(item.receiptRawInputRef),
        receiptCreatedAt: toIso(item.receiptCreatedAt),
        totalGrams: item.totalGrams,
        calories: item.calories,
        proteinG: item.proteinG,
        carbsG: item.carbsG,
        fatG: item.fatG,
        alcoholG: item.alcoholG,
        caffeineMg: item.caffeineMg,
        activeIngredientsJson: item.activeIngredientsJson,
      }),
    ),
  };
}

export default async function ReceiptCalendarPage() {
  const data = await getCalendarData();

  return <ReceiptCalendarView receipts={data.receipts} items={data.items} />;
}
