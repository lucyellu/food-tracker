import { eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { CATEGORY_LABELS, isCategory } from "@/lib/products/category";
import { SpendSummaryView, type PeriodData } from "./SpendSummaryView";

const localIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function periodStarts() {
  const now = new Date();
  const weekAgo = new Date(now);
  weekAgo.setDate(now.getDate() - 6);
  return [
    { key: "today", label: "Today", start: localIso(now) },
    { key: "week", label: "This week", start: localIso(weekAgo) },
    { key: "month", label: "This month", start: `${localIso(now).slice(0, 7)}-01` },
    { key: "year", label: "This year", start: `${now.getFullYear()}-01-01` },
    { key: "all", label: "All time", start: "" },
  ];
}

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

function rank(map: Map<string, number>, limit: number) {
  return [...map.entries()]
    .filter(([, total]) => total > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
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

  const periods: PeriodData[] = periodStarts().map(({ key, label, start }) => {
    const inPeriod = (date: string | null) => {
      const iso = toIsoDate(date);
      return iso != null && iso >= start;
    };
    let total = 0;
    let count = 0;
    const vendorMap = new Map<string, number>();
    for (const r of receipts) {
      if (r.total == null || !inPeriod(r.purchasedAt)) continue;
      total += r.total;
      count++;
      if (r.vendor) {
        const v = normalizeVendor(r.vendor);
        vendorMap.set(v, (vendorMap.get(v) ?? 0) + r.total);
      }
    }
    const categoryMap = new Map<string, number>();
    for (const item of items) {
      if (item.price == null || !inPeriod(item.purchasedAt)) continue;
      const k = item.category ?? "other";
      categoryMap.set(k, (categoryMap.get(k) ?? 0) + item.price);
    }
    return {
      key,
      label,
      total,
      count,
      vendors: rank(vendorMap, 10).map(([vendor, t]) => ({ key: vendor, label: vendor, total: t })),
      categories: rank(categoryMap, 20).map(([k, t]) => ({
        key: k,
        label: isCategory(k) ? CATEGORY_LABELS[k] : "Other",
        total: t,
      })),
    };
  });

  return <SpendSummaryView periods={periods} />;
}
