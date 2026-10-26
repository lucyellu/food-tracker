import { eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { CATEGORY_LABELS, isCategory } from "@/lib/products/category";
import { SpendSummaryView, type SpendItem, type SpendReceipt } from "./SpendSummaryView";

const localIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function toIsoDate(purchasedAt: string | null): string | null {
  if (!purchasedAt) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(purchasedAt)) return purchasedAt;
  const d = new Date(purchasedAt);
  return Number.isNaN(d.getTime()) ? null : localIso(d);
}

const VENDOR_PATTERNS: Array<[RegExp, string]> = [
  [/t&t/i, "T&T Supermarket"],
  [/\bcostco\b/i, "Costco"],
  [/pricesmart/i, "PriceSmart Foods"],
  [/dutch\s*love/i, "Dutch Love"],
  [/\buber\s*eats\b/i, "Uber Eats"],
  [/london\s*drugs/i, "London Drugs"],
  [/\bfreshco\b/i, "FreshCo"],
];

function normalizeVendor(vendor: string): string {
  for (const [pattern, canonical] of VENDOR_PATTERNS) {
    if (pattern.test(vendor)) return canonical;
  }
  return vendor.replace(/\s+-\s+Order\s+#\S+/i, "").trim();
}

export async function SpendSummary({
  receipts,
}: {
  receipts: Array<{ purchasedAt: string | null; total: number | null; vendor: string | null }>;
}) {
  const items = await db
    .select({
      category: schema.lineItems.category,
      price: schema.lineItems.price,
      purchasedAt: schema.receipts.purchasedAt,
    })
    .from(schema.lineItems)
    .innerJoin(schema.receipts, eq(schema.receipts.id, schema.lineItems.receiptId));

  // Compact rows; the view filters them by whichever period is picked, in the viewer's own timezone.
  const receiptRows: SpendReceipt[] = [];
  for (const r of receipts) {
    const date = toIsoDate(r.purchasedAt);
    if (date && r.total != null) receiptRows.push({ d: date, t: r.total, v: r.vendor ? normalizeVendor(r.vendor) : null });
  }
  const itemRows: SpendItem[] = [];
  for (const item of items) {
    const date = toIsoDate(item.purchasedAt);
    if (date && item.price != null) itemRows.push({ d: date, c: item.category ?? "other", p: item.price });
  }
  const labels: Record<string, string> = {};
  for (const row of itemRows) labels[row.c] = isCategory(row.c) ? CATEGORY_LABELS[row.c] : "Other";

  return <SpendSummaryView receipts={receiptRows} items={itemRows} categoryLabels={labels} />;
}
