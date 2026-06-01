"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink, Trash2 } from "lucide-react";

export type DuplicateReceipt = {
  id: number;
  vendor: string | null;
  source: string;
  sourceLabel: string;
  itemCount: number;
};

export type DuplicateGroup = {
  key: string;
  purchasedAt: string;
  total: number;
  receipts: DuplicateReceipt[];
};

function formatMoney(n: number) {
  return `$${n.toFixed(2)}`;
}

export function PotentialDuplicates({ groups }: { groups: DuplicateGroup[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const [deleting, setDeleting] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);

  if (groups.length === 0) return null;

  const totalDupes = groups.reduce((sum, group) => sum + group.receipts.length, 0);

  async function remove(id: number) {
    if (!window.confirm("Delete this receipt? This removes it and its line items permanently.")) return;
    setError(null);
    setDeleting((prev) => new Set(prev).add(id));
    try {
      const res = await fetch(`/api/receipts/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `Delete failed: ${res.status}`);
        return;
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete receipt.");
    } finally {
      setDeleting((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  return (
    <section className="rounded-lg border border-amber-200 bg-amber-50/50 dark:border-amber-900/60 dark:bg-amber-950/20">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-200">
          {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          Potential duplicates
        </span>
        <span className="text-xs text-amber-800/80 dark:text-amber-300/80">
          {groups.length} group{groups.length === 1 ? "" : "s"} · {totalDupes} receipts with the same date &amp; total
        </span>
      </button>

      {open ? (
        <div className="space-y-3 border-t border-amber-200 px-4 py-3 dark:border-amber-900/60">
          {error ? (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
              {error}
            </div>
          ) : null}
          <p className="text-xs text-zinc-600 dark:text-zinc-400">
            These receipts share an exact total and purchase date. Review each group and delete the copies you don&apos;t
            want — keep the one with the most complete items.
          </p>
          {groups.map((group) => (
            <div
              key={group.key}
              className="overflow-hidden rounded-md border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="flex items-center justify-between gap-2 bg-zinc-50 px-3 py-2 text-xs font-medium text-zinc-600 dark:bg-zinc-800/50 dark:text-zinc-300">
                <span>{group.purchasedAt}</span>
                <span>
                  {formatMoney(group.total)} · {group.receipts.length} receipts
                </span>
              </div>
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {group.receipts.map((receipt) => {
                  const busy = deleting.has(receipt.id);
                  return (
                    <li key={receipt.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <div className="min-w-0">
                        <Link
                          href={`/receipts/${receipt.id}`}
                          className="inline-flex items-center gap-1 font-medium hover:underline"
                        >
                          {receipt.vendor ?? "Unknown"}
                          <ExternalLink className="size-3 text-zinc-400" />
                        </Link>
                        <div className="text-xs text-zinc-500">
                          {receipt.itemCount} item{receipt.itemCount === 1 ? "" : "s"} · {receipt.sourceLabel}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void remove(receipt.id)}
                        disabled={busy}
                        className="inline-flex items-center gap-1 rounded-md border border-rose-200 px-2 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-900 dark:text-rose-300 dark:hover:bg-rose-950/30"
                      >
                        <Trash2 className="size-3.5" />
                        {busy ? "Deleting…" : "Delete"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
