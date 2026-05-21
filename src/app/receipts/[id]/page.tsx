import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db/client";

export const dynamic = "force-dynamic";

async function getReceipt(id: number) {
  const receipt = await db.query.receipts.findFirst({
    where: eq(schema.receipts.id, id),
  });
  if (!receipt) return null;
  const items = await db
    .select()
    .from(schema.lineItems)
    .where(eq(schema.lineItems.receiptId, id));
  return { receipt, items };
}

function formatMoney(n: number | null) {
  if (n == null) return "—";
  return `$${n.toFixed(2)}`;
}

function formatDate(iso: string | null) {
  if (!iso) return "—";
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

  const summedPrice = items.reduce((acc, it) => acc + (it.price ?? 0), 0);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/receipts" className="text-sm text-zinc-500 hover:underline">
          ← All receipts
        </Link>
        <h1 className="text-2xl font-semibold mt-2">{receipt.vendor ?? "Unknown vendor"}</h1>
        <p className="text-sm text-zinc-500 mt-1">
          {formatDate(receipt.purchasedAt)} · {items.length} items · {formatMoney(receipt.total)}
        </p>
      </div>

      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 dark:bg-zinc-800/50 text-zinc-600 dark:text-zinc-400 text-left">
            <tr>
              <th className="px-4 py-3 font-medium">Item</th>
              <th className="px-4 py-3 font-medium text-right">Qty</th>
              <th className="px-4 py-3 font-medium">Unit</th>
              <th className="px-4 py-3 font-medium text-right">Price</th>
              <th className="px-4 py-3 font-medium">Nutrition</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr
                key={it.id}
                className="border-t border-zinc-100 dark:border-zinc-800"
              >
                <td className="px-4 py-3 font-medium">{it.rawName}</td>
                <td className="px-4 py-3 text-right">{it.quantity}</td>
                <td className="px-4 py-3 text-zinc-500">{it.unit}</td>
                <td className="px-4 py-3 text-right">{formatMoney(it.price)}</td>
                <td className="px-4 py-3 text-xs">
                  <span
                    className={
                      it.nutritionStatus === "matched"
                        ? "text-green-600"
                        : it.nutritionStatus === "unmatched"
                          ? "text-amber-600"
                          : "text-zinc-500"
                    }
                  >
                    {it.nutritionStatus}
                  </span>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-zinc-500">
                  No items parsed from this receipt.
                </td>
              </tr>
            )}
          </tbody>
          {items.length > 0 && (
            <tfoot className="bg-zinc-50 dark:bg-zinc-800/30 text-sm">
              <tr>
                <td colSpan={3} className="px-4 py-3 font-medium text-right">
                  Sum of line item prices
                </td>
                <td className="px-4 py-3 text-right font-medium">
                  {formatMoney(summedPrice)}
                </td>
                <td></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <div className="text-xs text-zinc-500">
        Nutrition lookup is not wired up yet — coming in Phase 2 (USDA FoodData Central). All items
        currently show <code>pending</code>.
      </div>
    </div>
  );
}
