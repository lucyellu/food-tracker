import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { NutritionReadView } from "./NutritionReadView";
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

  return {
    receipt,
    items: rows.map((row) => ({ ...row.item, nutrition: row.nutrition })),
  };
}

function formatMoney(n: number | null) {
  if (n == null) return "-";
  return `$${n.toFixed(2)}`;
}

function addDaysToIso(iso: string | null, days: number) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const date = new Date(`${iso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export default async function ReceiptReadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const receiptId = Number(id);
  if (!Number.isFinite(receiptId)) notFound();

  const data = await getReceipt(receiptId);
  if (!data) notFound();

  const trackerItems = data.items.map((item) => ({
    ...item,
    rawName: item.rawName.replace(/^\[REFUNDED\]\s*/i, ""),
    consumptionStatus:
      item.rawName.startsWith("[REFUNDED]") && item.consumptionStatus === "available"
        ? "refunded"
        : (item.consumptionStatus ?? "available"),
  })) satisfies ReceiptTrackerItem[];

  const planEnd = addDaysToIso(data.receipt.purchasedAt, 7);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link href={`/receipts/${receiptId}`} className="text-sm text-zinc-500 hover:underline">
            Back to itemized receipt
          </Link>
          <h1 className="mt-2 text-2xl font-semibold">{data.receipt.vendor ?? "Unknown vendor"} nutrition read</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {data.receipt.purchasedAt}
            {planEnd ? ` to ${planEnd}` : ""} · {trackerItems.length} rows · {formatMoney(data.receipt.total)}
          </p>
        </div>
      </div>

      <NutritionReadView
        purchasedAt={data.receipt.purchasedAt}
        initialItems={trackerItems}
      />
    </div>
  );
}
