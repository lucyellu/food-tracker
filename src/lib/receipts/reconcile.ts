import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db/client";

// The same purchase often arrives twice: an order confirmation plus the final receipt, or one email parsed by
// both the vendor parser and the LLM. Substitutions and refunds make the item lists and totals differ slightly,
// so exact-signature dedupe (dedupe.ts) misses them. This merges receipts that are clearly the same trip.

type Candidate = {
  id: number;
  vendor: string | null;
  purchasedAt: string | null;
  total: number | null;
  sourceMessageId: string | null;
  createdAt: Date | number | null;
  names: Set<string>;
};

export type ReceiptMerge = {
  keepId: number;
  dropId: number;
  reason: string;
  keep: string;
  drop: string;
};

export function vendorFamily(vendor: string | null) {
  const v = (vendor ?? "").toLowerCase();
  if (v.includes("costco")) return "costco";
  if (v.includes("pricesmart")) return "pricesmart";
  if (v.startsWith("t&t") || v.startsWith("tnt")) return "t&t";
  return v.replace(/\s*-\s*order.*$/, "").replace(/\s+/g, " ").trim();
}

function itemKey(rawName: string) {
  return rawName.toLowerCase().replace(/^\[refunded\]\s*/, "").replace(/\s+/g, " ").trim();
}

function daysApart(a: string | null, b: string | null) {
  if (!a || !b) return Infinity;
  return Math.abs(new Date(a.slice(0, 10)).getTime() - new Date(b.slice(0, 10)).getTime()) / 86_400_000;
}

function jaccard(a: Set<string>, b: Set<string>) {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

function sameTotal(a: number | null, b: number | null) {
  return a != null && b != null && Math.abs(a - b) < 0.015;
}

function sameTrip(a: Candidate, b: Candidate) {
  const family = vendorFamily(a.vendor);
  if (!family || family !== vendorFamily(b.vendor)) return null;
  if (a.names.size < 2 || b.names.size < 2) return null; // adjustment-only notices are not real receipts
  const days = daysApart(a.purchasedAt, b.purchasedAt);
  const overlap = jaccard(a.names, b.names);
  if (days <= 1 && sameTotal(a.total, b.total) && overlap >= 0.25) return "same day and total";
  if (days <= 1 && overlap >= 0.6) return "same day, near-identical items";
  if (days <= 3 && overlap >= 0.8) return "within 3 days, near-identical items (substitution or refund)";
  return null;
}

// Prefer the structured vendor-order parse, then the one with more items, then the later (final) receipt.
function score(c: Candidate) {
  const created = c.createdAt instanceof Date ? c.createdAt.getTime() : Number(c.createdAt ?? 0);
  return (
    (c.sourceMessageId?.startsWith("tnt:order:") ? 1000 : 0) +
    (/order\s*#/i.test(c.vendor ?? "") ? 100 : 0) +
    c.names.size +
    created / 1e15
  );
}

const label = (c: Candidate) => `#${c.id} ${c.vendor ?? "?"} ${c.purchasedAt?.slice(0, 10)} $${c.total} (${c.names.size} items)`;

export async function reconcileDuplicateReceipts({ dryRun = true }: { dryRun?: boolean } = {}) {
  const receipts = await db.select().from(schema.receipts);
  const items = await db
    .select({ receiptId: schema.lineItems.receiptId, rawName: schema.lineItems.rawName })
    .from(schema.lineItems);
  const namesById = new Map<number, Set<string>>();
  for (const item of items) {
    const set = namesById.get(item.receiptId) ?? new Set<string>();
    set.add(itemKey(item.rawName));
    namesById.set(item.receiptId, set);
  }

  const candidates: Candidate[] = receipts
    .filter((r) => r.purchasedAt)
    .map((r) => ({
      id: r.id,
      vendor: r.vendor,
      purchasedAt: r.purchasedAt,
      total: r.total,
      sourceMessageId: r.sourceMessageId,
      createdAt: r.createdAt as Date | number | null,
      names: namesById.get(r.id) ?? new Set(),
    }))
    .sort((a, b) => (a.purchasedAt ?? "").localeCompare(b.purchasedAt ?? ""));

  const merges: ReceiptMerge[] = [];
  const dropped = new Set<number>();
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i];
      const b = candidates[j];
      if (daysApart(a.purchasedAt, b.purchasedAt) > 3) break;
      if (dropped.has(a.id) || dropped.has(b.id)) continue;
      const reason = sameTrip(a, b);
      if (!reason) continue;
      const [keep, drop] = score(a) >= score(b) ? [a, b] : [b, a];
      dropped.add(drop.id);
      merges.push({ keepId: keep.id, dropId: drop.id, reason, keep: label(keep), drop: label(drop) });
    }
  }

  if (!dryRun && merges.length > 0) {
    const ids = merges.map((m) => m.dropId);
    for (let i = 0; i < ids.length; i += 50) {
      await db.delete(schema.receipts).where(inArray(schema.receipts.id, ids.slice(i, i + 50)));
    }
  }
  return merges;
}

export async function receiptCount() {
  return (await db.select({ id: schema.receipts.id }).from(schema.receipts).where(eq(schema.receipts.parseStatus, "parsed"))).length;
}
