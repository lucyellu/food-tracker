import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { mergeCatalogFieldsIntoLineItem } from "@/lib/products/catalog";
import { EnrichNutritionButton } from "./EnrichNutritionButton";
import { EnrichProductsButton } from "./EnrichProductsButton";
import {
  ReceiptNutritionTracker,
  type ReceiptTrackerItem,
} from "./ReceiptNutritionTracker";

export const dynamic = "force-dynamic";

async function getReceipt(id: number) {
  const receipt = await db.query.receipts.findFirst({
    where: eq(schema.receipts.id, id),
  });
  if (!receipt) return null;
  const rows = await db
    .select({
      item: schema.lineItems,
      product: schema.productCatalog,
      nutrition: schema.nutritionFacts,
    })
    .from(schema.lineItems)
    .leftJoin(schema.productCatalog, eq(schema.productCatalog.id, schema.lineItems.productId))
    .leftJoin(schema.nutritionFacts, eq(schema.nutritionFacts.lineItemId, schema.lineItems.id))
    .where(eq(schema.lineItems.receiptId, id))
    .orderBy(asc(schema.lineItems.id));
  const items = rows.map((row) => ({
    ...mergeCatalogFieldsIntoLineItem(row.item, row.product),
    nutrition: row.nutrition,
  }));
  const logs = await db
    .select()
    .from(schema.consumptionLogs)
    .where(eq(schema.consumptionLogs.receiptId, id))
    .orderBy(asc(schema.consumptionLogs.consumedAt), asc(schema.consumptionLogs.id));
  return { receipt, items, logs };
}

async function getReceiptOutline() {
  return db
    .select({
      id: schema.receipts.id,
      vendor: schema.receipts.vendor,
      purchasedAt: schema.receipts.purchasedAt,
      total: schema.receipts.total,
      itemCount: sql<number>`COUNT(${schema.lineItems.id})`.as("item_count"),
    })
    .from(schema.receipts)
    .leftJoin(schema.lineItems, eq(schema.lineItems.receiptId, schema.receipts.id))
    .groupBy(schema.receipts.id)
    .orderBy(desc(schema.receipts.createdAt));
}

function formatMoney(n: number | null) {
  if (n == null) return "—";
  return `$${n.toFixed(2)}`;
}

function formatDate(iso: string | null) {
  if (!iso) return "—";
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}

function addDaysToIso(iso: string | null, days: number) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const date = new Date(`${iso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatPlanRange(iso: string | null, days: number) {
  if (!iso) return "—";
  const start = formatDate(iso);
  const end = addDaysToIso(iso, days);
  return end ? `${start} to ${end}` : start;
}

export default async function ReceiptDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const receiptId = Number(id);
  if (!Number.isFinite(receiptId)) notFound();

  const [data, receiptOutline] = await Promise.all([
    getReceipt(receiptId),
    getReceiptOutline(),
  ]);
  if (!data) notFound();
  const { receipt, items, logs } = data;
  const trackerItems = items.map((item) => ({
    ...item,
    rawName: item.rawName.replace(/^\[REFUNDED\]\s*/i, ""),
    consumptionStatus:
      item.rawName.startsWith("[REFUNDED]") && item.consumptionStatus === "available"
        ? "refunded"
        : (item.consumptionStatus ?? "available"),
  })) satisfies ReceiptTrackerItem[];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <Link href="/receipts" className="text-sm text-zinc-500 hover:underline">
            ← All receipts
          </Link>
          <h1 className="text-2xl font-semibold mt-2">{receipt.vendor ?? "Unknown vendor"}</h1>
          <p className="text-sm text-zinc-500 mt-1">
            {formatPlanRange(receipt.purchasedAt, 7)} · {items.length} receipt rows ·{" "}
            {formatMoney(receipt.total)}
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <Link
            href={`/receipts/${receiptId}/read`}
            className="rounded-md border border-zinc-200 px-3 py-2 text-center text-sm font-medium hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
          >
            Read nutrition
          </Link>
          <Link
            href={`/receipts/${receiptId}/inventory`}
            className="rounded-md border border-zinc-200 px-3 py-2 text-center text-sm font-medium hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
          >
            Inventory lab
          </Link>
          <EnrichNutritionButton receiptId={receiptId} />
          <EnrichProductsButton receiptId={receiptId} />
        </div>
      </div>

      <ReceiptNutritionTracker
        receiptId={receiptId}
        initialItems={trackerItems}
        initialLogs={logs}
        receiptOutline={receiptOutline}
        purchasedAt={receipt.purchasedAt}
      />

      <div className="text-xs text-zinc-500">
        Nutrition comes from USDA FoodData Central. Item totals are estimated only when the receipt
        exposes a weight or package size; otherwise the row shows a per-100g reference. Salt is
        calculated from sodium as sodium chloride equivalent.
      </div>
    </div>
  );
}
