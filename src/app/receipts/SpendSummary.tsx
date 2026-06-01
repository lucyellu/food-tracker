import { desc, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { CATEGORY_LABELS, isCategory } from "@/lib/products/category";

type PeriodTotals = {
  week: { total: number; count: number };
  month: { total: number; count: number };
  year: { total: number; count: number };
  allTime: { total: number; count: number };
};

type VendorEntry = { vendor: string; total: number };
type CategoryEntry = { key: string; label: string; total: number };

function money(n: number) {
  return n >= 10000
    ? `$${(n / 1000).toFixed(1)}k`
    : `$${n.toFixed(2)}`;
}

function getDateBoundaries() {
  const now = new Date();
  const y = now.getFullYear();
  const m = (now.getMonth() + 1).toString().padStart(2, "0");
  const weekAgo = new Date(now);
  weekAgo.setDate(now.getDate() - 6);
  return {
    weekStart: weekAgo.toISOString().slice(0, 10),
    monthStart: `${y}-${m}-01`,
    yearStart: `${y}-01-01`,
  };
}

function toIsoDate(purchasedAt: string | null): string | null {
  if (!purchasedAt) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(purchasedAt)) return purchasedAt;
  try {
    const d = new Date(purchasedAt);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

function computePeriodTotals(
  receipts: Array<{ purchasedAt: string | null; total: number | null }>,
): PeriodTotals {
  const { weekStart, monthStart, yearStart } = getDateBoundaries();
  const zero = () => ({ total: 0, count: 0 });
  const result = { week: zero(), month: zero(), year: zero(), allTime: zero() };
  for (const r of receipts) {
    const date = toIsoDate(r.purchasedAt);
    if (!date || r.total == null) continue;
    result.allTime.total += r.total;
    result.allTime.count++;
    if (date >= yearStart) {
      result.year.total += r.total;
      result.year.count++;
    }
    if (date >= monthStart) {
      result.month.total += r.total;
      result.month.count++;
    }
    if (date >= weekStart) {
      result.week.total += r.total;
      result.week.count++;
    }
  }
  return result;
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

function computeTopVendors(
  receipts: Array<{ vendor: string | null; total: number | null }>,
  limit = 10,
): VendorEntry[] {
  const map = new Map<string, number>();
  for (const r of receipts) {
    if (!r.vendor || r.total == null) continue;
    const vendor = normalizeVendor(r.vendor);
    map.set(vendor, (map.get(vendor) ?? 0) + r.total);
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([vendor, total]) => ({ vendor, total }));
}

async function getCategoryTotals(): Promise<CategoryEntry[]> {
  const rows = await db
    .select({
      category: schema.lineItems.category,
      total: sql<number>`COALESCE(SUM(${schema.lineItems.price}), 0)`,
    })
    .from(schema.lineItems)
    .groupBy(schema.lineItems.category)
    .orderBy(desc(sql`SUM(${schema.lineItems.price})`));

  return rows
    .filter((r) => (r.total ?? 0) > 0)
    .map((r) => ({
      key: r.category ?? "other",
      label: isCategory(r.category) ? CATEGORY_LABELS[r.category] : "Other",
      total: r.total ?? 0,
    }));
}

function BarRow({ label, value, max, href }: { label: string; value: number; max: number; href?: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        {href ? (
          <a href={href} className="truncate hover:underline">{label}</a>
        ) : (
          <span className="truncate">{label}</span>
        )}
        <span className="shrink-0 tabular-nums text-zinc-500 dark:text-zinc-400">{money(value)}</span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        <div
          className="h-full rounded-full bg-zinc-400 dark:bg-zinc-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export async function SpendSummary({
  receipts,
}: {
  receipts: Array<{ purchasedAt: string | null; total: number | null; vendor: string | null }>;
}) {
  const [categories, periods] = await Promise.all([
    getCategoryTotals(),
    Promise.resolve(computePeriodTotals(receipts)),
  ]);
  const vendors = computeTopVendors(receipts);

  const maxVendor = vendors[0]?.total ?? 1;
  const maxCategory = categories[0]?.total ?? 1;

  const periodCards = [
    { label: "This week", data: periods.week },
    { label: "This month", data: periods.month },
    { label: "This year", data: periods.year },
    { label: "All time", data: periods.allTime },
  ];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {periodCards.map(({ label, data }) => (
          <div
            key={label}
            className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="text-xs text-zinc-500 dark:text-zinc-400">{label}</div>
            <div className="mt-1 text-xl font-semibold tabular-nums">
              {data.count > 0 ? money(data.total) : <span className="text-zinc-400">—</span>}
            </div>
            {data.count > 0 && (
              <div className="mt-0.5 text-xs text-zinc-400">
                {data.count} receipt{data.count !== 1 ? "s" : ""}
              </div>
            )}
          </div>
        ))}
      </div>

      {(vendors.length > 0 || categories.length > 0) && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {vendors.length > 0 && (
            <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                By vendor · all time
              </div>
              <div className="space-y-2">
                {vendors.map((v) => (
                  <BarRow key={v.vendor} label={v.vendor} value={v.total} max={maxVendor} />
                ))}
              </div>
            </div>
          )}

          {categories.length > 0 && (
            <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                By category · all time
              </div>
              <div className="space-y-2">
                {categories.map((c) => (
                  <BarRow key={c.key} label={c.label} value={c.total} max={maxCategory} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
