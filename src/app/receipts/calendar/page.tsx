import { asc, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import {
  ReceiptCalendarView,
  type CalendarItem,
  type CalendarLog,
  type CalendarReceipt,
} from "./ReceiptCalendarView";

export const dynamic = "force-dynamic";

function toIso(value: Date | string | null | undefined) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function getCalendarData() {
  const [receipts, items, logs] = await Promise.all([
    db
      .select({
        id: schema.receipts.id,
        vendor: schema.receipts.vendor,
        purchasedAt: schema.receipts.purchasedAt,
        total: schema.receipts.total,
        source: schema.receipts.source,
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
        receiptCreatedAt: schema.receipts.createdAt,
      })
      .from(schema.lineItems)
      .innerJoin(schema.receipts, eq(schema.receipts.id, schema.lineItems.receiptId))
      .orderBy(desc(schema.receipts.createdAt), asc(schema.lineItems.id)),
    db
      .select({
        id: schema.consumptionLogs.id,
        receiptId: schema.consumptionLogs.receiptId,
        lineItemId: schema.consumptionLogs.lineItemId,
        consumedAt: schema.consumptionLogs.consumedAt,
        amount: schema.consumptionLogs.amount,
        unit: schema.consumptionLogs.unit,
        note: schema.consumptionLogs.note,
      })
      .from(schema.consumptionLogs)
      .orderBy(desc(schema.consumptionLogs.consumedAt), desc(schema.consumptionLogs.id)),
  ]);

  return {
    receipts: receipts.map(
      (receipt): CalendarReceipt => ({
        ...receipt,
        createdAt: toIso(receipt.createdAt),
      }),
    ),
    items: items.map(
      (item): CalendarItem => ({
        ...item,
        rawName: item.rawName.replace(/^\[REFUNDED\]\s*/i, ""),
        receiptCreatedAt: toIso(item.receiptCreatedAt),
      }),
    ),
    logs: logs satisfies CalendarLog[],
  };
}

export default async function ReceiptCalendarPage() {
  const data = await getCalendarData();

  return <ReceiptCalendarView receipts={data.receipts} items={data.items} logs={data.logs} />;
}
