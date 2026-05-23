import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import {
  InventoryClone,
  type InventoryReceipt,
} from "./InventoryClone";
import type { ReceiptTrackerItem } from "../ReceiptNutritionTracker";

export const dynamic = "force-dynamic";

async function getReceipt(id: number) {
  const receipt = await db.query.receipts.findFirst({
    where: eq(schema.receipts.id, id),
  });
  if (!receipt) return null;

  const rows = await db
    .select({
      item: schema.lineItems,
      nutrition: schema.nutritionFacts,
    })
    .from(schema.lineItems)
    .leftJoin(schema.nutritionFacts, eq(schema.nutritionFacts.lineItemId, schema.lineItems.id))
    .where(eq(schema.lineItems.receiptId, id))
    .orderBy(asc(schema.lineItems.id));

  const logs = await db
    .select()
    .from(schema.consumptionLogs)
    .where(eq(schema.consumptionLogs.receiptId, id))
    .orderBy(asc(schema.consumptionLogs.consumedAt), asc(schema.consumptionLogs.id));

  return {
    receipt,
    items: rows.map((row) => ({ ...row.item, nutrition: row.nutrition })),
    logs,
  };
}

function formatMoney(n: number | null) {
  if (n == null) return "-";
  return `$${n.toFixed(2)}`;
}

export default async function InventoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const receiptId = Number(id);
  if (!Number.isFinite(receiptId)) notFound();

  const data = await getReceipt(receiptId);
  if (!data) notFound();

  const receipt: InventoryReceipt = {
    id: data.receipt.id,
    vendor: data.receipt.vendor,
    purchasedAt: data.receipt.purchasedAt,
    total: data.receipt.total,
  };

  const trackerItems = data.items.map((item) => ({
    ...item,
    rawName: item.rawName.replace(/^\[REFUNDED\]\s*/i, ""),
    consumptionStatus:
      item.rawName.startsWith("[REFUNDED]") && item.consumptionStatus === "available"
        ? "refunded"
        : (item.consumptionStatus ?? "available"),
  })) satisfies ReceiptTrackerItem[];

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link href={`/receipts/${receiptId}`} className="text-sm text-zinc-500 hover:underline">
            ← Receipt table
          </Link>
          <h1 className="mt-2 text-2xl font-semibold">{receipt.vendor ?? "Kitchen inventory"}</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {receipt.purchasedAt ?? "No date"} · {trackerItems.length} receipt rows · {formatMoney(receipt.total)}
          </p>
        </div>
      </div>

      <InventoryClone receipt={receipt} initialItems={trackerItems} initialLogs={data.logs} />
    </div>
  );
}
