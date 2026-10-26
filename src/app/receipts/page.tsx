import Link from "next/link";
import { unstable_cache } from "next/cache";
import { desc, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { FOOD_DATA_CACHE_SECONDS, FOOD_DATA_CACHE_TAG } from "@/lib/food-data-cache";
import { RecategorizeButton } from "./RecategorizeButton";
import { PotentialDuplicates, type DuplicateGroup, type DuplicateItem } from "./PotentialDuplicates";
import { itemKey, reconcileDuplicateReceipts } from "@/lib/receipts/reconcile";
import { SpendSummary } from "./SpendSummary";

export const dynamic = "force-dynamic";

type SortKey = "vendor" | "date" | "items" | "total" | "source";
type SortDir = "asc" | "desc";

const SORT_LABELS: Record<SortKey, string> = {
  vendor: "Vendor",
  date: "Date",
  items: "Items",
  total: "Total",
  source: "Source",
};

async function getReceipts() {
  return db
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
    .leftJoin(schema.lineItems, sql`${schema.lineItems.receiptId} = ${schema.receipts.id}`)
    .groupBy(schema.receipts.id)
    .orderBy(desc(schema.receipts.createdAt));
}

const getCachedReceipts = unstable_cache(getReceipts, ["receipts-page"], {
  tags: [FOOD_DATA_CACHE_TAG],
  revalidate: FOOD_DATA_CACHE_SECONDS,
});

const SOURCE_LABEL: Record<string, string> = {
  manual_text: "pasted text",
  manual_email_paste: "pasted email",
  manual_image: "photo/PDF",
  auto_email: "auto email",
  google_photos: "Google Photos",
};

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

function parseSort(value: string | string[] | undefined): SortKey {
  return value === "vendor" || value === "date" || value === "items" || value === "total" || value === "source"
    ? value
    : "date";
}

function parseDir(value: string | string[] | undefined): SortDir {
  return value === "asc" ? "asc" : "desc";
}

function compareText(a: string | null, b: string | null) {
  return (a ?? "").localeCompare(b ?? "", undefined, { sensitivity: "base" });
}

function compareNumber(a: number | null, b: number | null) {
  return (a ?? Number.NEGATIVE_INFINITY) - (b ?? Number.NEGATIVE_INFINITY);
}

function sortedReceipts(receipts: Awaited<ReturnType<typeof getReceipts>>, sort: SortKey, dir: SortDir) {
  const direction = dir === "asc" ? 1 : -1;
  return [...receipts].sort((a, b) => {
    const result =
      sort === "vendor"
        ? compareText(a.vendor, b.vendor)
        : sort === "date"
          ? compareText(a.purchasedAt, b.purchasedAt)
          : sort === "items"
            ? compareNumber(a.itemCount, b.itemCount)
            : sort === "total"
              ? compareNumber(a.total, b.total)
              : compareText(SOURCE_LABEL[a.source] ?? a.source, SOURCE_LABEL[b.source] ?? b.source);
    return result === 0 ? b.id - a.id : result * direction;
  });
}

// Groups receipts that look like the same purchase: an exact purchase date and total, or the fuzzier
// same-trip match used by the auto-merge (substitutions and refunds shift items and totals slightly).
async function buildDuplicateGroups(receipts: Awaited<ReturnType<typeof getReceipts>>): Promise<DuplicateGroup[]> {
  const byId = new Map(receipts.map((r) => [r.id, r]));
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    const p = parent.get(x) ?? x;
    if (p === x) return x;
    const root = find(p);
    parent.set(x, root);
    return root;
  };
  const union = (a: number, b: number) => parent.set(find(a), find(b));

  const exact = new Map<string, number[]>();
  for (const r of receipts) {
    if (!r.purchasedAt || r.total == null) continue;
    const key = `${r.purchasedAt}|${Math.round(r.total * 100)}`;
    exact.set(key, [...(exact.get(key) ?? []), r.id]);
  }
  for (const ids of exact.values()) for (const id of ids.slice(1)) union(ids[0], id);
  for (const m of await reconcileDuplicateReceipts({ dryRun: true })) union(m.keepId, m.dropId);

  const members = new Map<number, number[]>();
  for (const r of receipts) {
    const root = find(r.id);
    members.set(root, [...(members.get(root) ?? []), r.id]);
  }
  const groupIds = [...members.values()].filter((ids) => ids.length > 1);
  if (groupIds.length === 0) return [];

  const items = await db
    .select({
      id: schema.lineItems.id,
      receiptId: schema.lineItems.receiptId,
      rawName: schema.lineItems.rawName,
      quantity: schema.lineItems.quantity,
      price: schema.lineItems.price,
    })
    .from(schema.lineItems)
    .where(inArray(schema.lineItems.receiptId, groupIds.flat()));
  const itemsByReceipt = new Map<number, DuplicateItem[]>();
  for (const item of items) {
    itemsByReceipt.set(item.receiptId, [
      ...(itemsByReceipt.get(item.receiptId) ?? []),
      { id: item.id, name: item.rawName, key: itemKey(item.rawName), quantity: item.quantity, price: item.price },
    ]);
  }

  return groupIds
    .map((ids) => {
      const rs = ids.map((id) => byId.get(id)!).sort((a, b) => Number(b.itemCount) - Number(a.itemCount) || a.id - b.id);
      return {
        key: ids.slice().sort((a, b) => a - b).join("-"),
        purchasedAt: rs.map((r) => r.purchasedAt ?? "").sort().at(-1) ?? "",
        receipts: rs.map((r) => ({
          id: r.id,
          vendor: r.vendor,
          purchasedAt: r.purchasedAt,
          total: r.total,
          sourceLabel: SOURCE_LABEL[r.source] ?? r.source,
          items: itemsByReceipt.get(r.id) ?? [],
        })),
      };
    })
    .sort((a, b) => b.purchasedAt.localeCompare(a.purchasedAt));
}

function sortHref(key: SortKey, activeSort: SortKey, activeDir: SortDir) {
  const nextDir: SortDir = activeSort === key && activeDir === "asc" ? "desc" : "asc";
  return `/receipts?sort=${key}&dir=${nextDir}`;
}

function SortHeader({
  sortKey,
  activeSort,
  activeDir,
  align = "left",
}: {
  sortKey: SortKey;
  activeSort: SortKey;
  activeDir: SortDir;
  align?: "left" | "right";
}) {
  const active = activeSort === sortKey;
  return (
    <th className={`px-4 py-3 font-medium ${align === "right" ? "text-right" : ""}`}>
      <Link
        href={sortHref(sortKey, activeSort, activeDir)}
        className={`inline-flex items-center gap-1 hover:text-zinc-900 dark:hover:text-zinc-100 ${
          align === "right" ? "justify-end" : ""
        }`}
      >
        {SORT_LABELS[sortKey]}
        <span className="text-[10px] text-zinc-400">{active ? (activeDir === "asc" ? "▲" : "▼") : "↕"}</span>
      </Link>
    </th>
  );
}

export default async function ReceiptsPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string | string[]; dir?: string | string[] }>;
}) {
  const params = await searchParams;
  const sort = parseSort(params.sort);
  const dir = parseDir(params.dir);
  const receipts = sortedReceipts(await getCachedReceipts(), sort, dir);
  const duplicateGroups = await buildDuplicateGroups(receipts);

  if (receipts.length === 0) {
    return (
      <div className="text-center py-16">
        <h1 className="text-xl font-medium mb-2">No receipts yet</h1>
        <p className="text-sm text-zinc-500 mb-6">
          Add one to see it here.
        </p>
        <Link
          href="/add"
          className="inline-block px-4 py-2 rounded-md bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-medium"
        >
          Add receipt
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold">All receipts</h1>
        <div className="flex items-center gap-3">
          <RecategorizeButton />
          <span className="text-sm text-zinc-500">{receipts.length} total</span>
        </div>
      </div>

      <SpendSummary receipts={receipts} />

      <PotentialDuplicates groups={duplicateGroups} />

      <div className="space-y-2 md:hidden">
        {receipts.map((r) => (
          <Link
            key={r.id}
            href={`/receipts/${r.id}`}
            className="block rounded-lg border border-zinc-200 bg-white p-3 text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate font-semibold">{r.vendor ?? "Unknown"}</div>
                <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  {formatDate(r.purchasedAt)} · {SOURCE_LABEL[r.source] ?? r.source}
                </div>
              </div>
              <div className="shrink-0 text-right font-semibold">{formatMoney(r.total)}</div>
            </div>
            <div className="mt-3 flex items-center justify-between rounded-md bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-950 dark:text-zinc-300">
              <span>{r.itemCount} items</span>
              <span>Open receipt</span>
            </div>
          </Link>
        ))}
      </div>

      <div className="hidden overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 md:block">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 dark:bg-zinc-800/50 text-zinc-600 dark:text-zinc-400 text-left">
            <tr>
              <SortHeader sortKey="vendor" activeSort={sort} activeDir={dir} />
              <SortHeader sortKey="date" activeSort={sort} activeDir={dir} />
              <SortHeader sortKey="items" activeSort={sort} activeDir={dir} align="right" />
              <SortHeader sortKey="total" activeSort={sort} activeDir={dir} align="right" />
              <SortHeader sortKey="source" activeSort={sort} activeDir={dir} />
            </tr>
          </thead>
          <tbody>
            {receipts.map((r) => (
              <tr
                key={r.id}
                className="border-t border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/30"
              >
                <td className="px-4 py-3">
                  <Link href={`/receipts/${r.id}`} className="font-medium hover:underline">
                    {r.vendor ?? "Unknown"}
                  </Link>
                </td>
                <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                  {formatDate(r.purchasedAt)}
                </td>
                <td className="px-4 py-3 text-right">{r.itemCount}</td>
                <td className="px-4 py-3 text-right font-medium">{formatMoney(r.total)}</td>
                <td className="px-4 py-3 text-zinc-500 text-xs">{SOURCE_LABEL[r.source] ?? r.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
