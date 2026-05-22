import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
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
      nutrition: schema.nutritionFacts,
    })
    .from(schema.lineItems)
    .leftJoin(schema.nutritionFacts, eq(schema.nutritionFacts.lineItemId, schema.lineItems.id))
    .where(eq(schema.lineItems.receiptId, id))
    .orderBy(asc(schema.lineItems.id));
  const items = rows.map((row) => ({ ...row.item, nutrition: row.nutrition }));
  return { receipt, items };
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

export default async function ReceiptDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const receiptId = Number(id);
  if (!Number.isFinite(receiptId)) notFound();

  const data = await getReceipt(receiptId);
  if (!data) notFound();
  const { receipt, items } = data;
  const trackerItems = items.map((item) => ({
    ...item,
    consumptionStatus: item.consumptionStatus ?? "available",
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
            {formatDate(receipt.purchasedAt)} · {items.length} items · {formatMoney(receipt.total)}
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <EnrichNutritionButton receiptId={receiptId} />
          <EnrichProductsButton receiptId={receiptId} />
        </div>
      </div>

      <ReceiptNutritionTracker receiptId={receiptId} initialItems={trackerItems} />

      <div className="text-xs text-zinc-500">
        Nutrition comes from USDA FoodData Central. Item totals are estimated only when the receipt
        exposes a weight or package size; otherwise the row shows a per-100g reference. Salt is
        calculated from sodium as sodium chloride equivalent.
      </div>
    </div>
  );
}
