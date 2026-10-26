"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink, GitMerge } from "lucide-react";

export type DuplicateItem = { id: number; name: string; key: string; quantity: number; price: number | null };

export type DuplicateReceipt = {
  id: number;
  vendor: string | null;
  purchasedAt: string | null;
  total: number | null;
  sourceLabel: string;
  items: DuplicateItem[];
};

export type DuplicateGroup = {
  key: string;
  purchasedAt: string;
  receipts: DuplicateReceipt[];
};

const DISMISS_KEY = "ft_dismissed_duplicates";

function money(n: number | null) {
  return n == null ? "—" : `$${n.toFixed(2)}`;
}

function loadDismissed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function GroupCard({ group, onDone }: { group: DuplicateGroup; onDone: (dismiss: boolean) => void }) {
  const router = useRouter();
  const { receipts } = group;
  const [keepId, setKeepId] = useState(receipts[0].id);
  const [totalFrom, setTotalFrom] = useState<number>(receipts[0].id);
  // Items that exist only on a receipt being dropped are brought over by default; unticking leaves them out.
  const [skipped, setSkipped] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const keepKeys = new Set(receipts.find((r) => r.id === keepId)!.items.map((i) => i.key));
  const otherKeys = (r: DuplicateReceipt) =>
    new Set(receipts.filter((o) => o.id !== r.id).flatMap((o) => o.items.map((i) => i.key)));
  // The same product on two dropped receipts would otherwise be added twice.
  const seen = new Set<string>();
  const moveIds = receipts
    .filter((r) => r.id !== keepId)
    .flatMap((r) => r.items.filter((i) => !keepKeys.has(i.key) && !skipped.has(i.id)))
    .filter((i) => (seen.has(i.key) ? false : (seen.add(i.key), true)))
    .map((i) => i.id);

  async function merge() {
    setBusy(true);
    setError(null);
    try {
      const total = receipts.find((r) => r.id === totalFrom)?.total ?? null;
      const res = await fetch("/api/receipts/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keepId,
          dropIds: receipts.filter((r) => r.id !== keepId).map((r) => r.id),
          moveItemIds: moveIds,
          total,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `Merge failed: ${res.status}`);
        return;
      }
      router.refresh();
      onDone(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not merge receipts.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overflow-hidden rounded-md border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div
        className="grid gap-px bg-zinc-200 dark:bg-zinc-800"
        style={{ gridTemplateColumns: `repeat(${receipts.length}, minmax(0, 1fr))` }}
      >
        {receipts.map((r) => {
          const isKeep = r.id === keepId;
          const others = otherKeys(r);
          return (
            <div key={r.id} className="bg-white p-3 dark:bg-zinc-900">
              <label className="flex cursor-pointer items-start gap-2">
                <input
                  type="radio"
                  name={`keep-${group.key}`}
                  checked={isKeep}
                  onChange={() => setKeepId(r.id)}
                  className="mt-1"
                />
                <span className="min-w-0 text-sm">
                  <Link href={`/receipts/${r.id}`} className="inline-flex items-center gap-1 font-medium hover:underline">
                    {r.vendor ?? "Unknown"}
                    <ExternalLink className="size-3 text-zinc-400" />
                  </Link>
                  <span className="block text-xs text-zinc-500">
                    {r.purchasedAt} · {r.sourceLabel} · {r.items.length} items
                  </span>
                  <span className="block text-xs text-zinc-500">
                    {isKeep ? "Keeping this one" : "Merged into the kept one, then removed"}
                  </span>
                </span>
              </label>
              <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
                <input
                  type="radio"
                  name={`total-${group.key}`}
                  checked={totalFrom === r.id}
                  onChange={() => setTotalFrom(r.id)}
                />
                Use total {money(r.total)}
              </label>
              <ul className="mt-2 max-h-72 space-y-0.5 overflow-y-auto text-xs">
                {r.items.map((item) => {
                  const shared = others.has(item.key);
                  const bringOver = !isKeep && !keepKeys.has(item.key);
                  const off = bringOver && skipped.has(item.id);
                  return (
                    <li
                      key={item.id}
                      className={`flex items-center gap-2 rounded px-1.5 py-0.5 ${
                        shared ? "text-zinc-500" : "bg-amber-100/70 text-zinc-900 dark:bg-amber-900/30 dark:text-zinc-100"
                      } ${off ? "line-through opacity-60" : ""}`}
                    >
                      {bringOver ? (
                        <input
                          type="checkbox"
                          checked={!off}
                          onChange={() =>
                            setSkipped((prev) => {
                              const next = new Set(prev);
                              if (!next.delete(item.id)) next.add(item.id);
                              return next;
                            })
                          }
                          title="Bring this item onto the kept receipt"
                        />
                      ) : (
                        <span className="w-[13px]" />
                      )}
                      <span className="min-w-0 flex-1 truncate">{item.name}</span>
                      <span className="tabular-nums">{money(item.price)}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <span className="text-xs text-zinc-500">
          Highlighted items are not on the other receipt
          {moveIds.length ? ` · ${moveIds.length} will move onto the kept receipt` : ""}
        </span>
        <span className="flex items-center gap-2">
          {error ? <span className="text-xs text-rose-600">{error}</span> : null}
          <button
            type="button"
            onClick={() => onDone(true)}
            className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Not duplicates
          </button>
          <button
            type="button"
            onClick={() => void merge()}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-md bg-zinc-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            <GitMerge className="size-3.5" />
            {busy ? "Merging…" : "Merge into one"}
          </button>
        </span>
      </div>
    </div>
  );
}

export function PotentialDuplicates({ groups }: { groups: DuplicateGroup[] }) {
  const [open, setOpen] = useState(true);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [merged, setMerged] = useState<Set<string>>(new Set());

  // localStorage is only readable after hydration.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setDismissed(loadDismissed()), []);

  const visible = groups.filter((g) => !dismissed.has(g.key) && !merged.has(g.key));
  if (visible.length === 0) return null;

  function done(key: string, dismiss: boolean) {
    if (!dismiss) {
      setMerged((prev) => new Set(prev).add(key));
      return;
    }
    const next = new Set(dismissed).add(key);
    setDismissed(next);
    try {
      localStorage.setItem(DISMISS_KEY, JSON.stringify([...next]));
    } catch {
      // dismissal just will not persist
    }
  }

  return (
    <section className="rounded-lg border border-amber-200 bg-amber-50/50 dark:border-amber-900/60 dark:bg-amber-950/20">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-200">
          {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          Potential duplicates
        </span>
        <span className="text-xs text-amber-800/80 dark:text-amber-300/80">
          {visible.length} group{visible.length === 1 ? "" : "s"} to review
        </span>
      </button>
      {open ? (
        <div className="space-y-3 border-t border-amber-200 px-4 py-3 dark:border-amber-900/60">
          <p className="text-xs text-zinc-600 dark:text-zinc-400">
            Compare side by side. Pick the receipt to keep and which total is right. Items only on the other copy are
            brought over (untick any you do not want), then the extra copy is removed.
          </p>
          {visible.map((group) => (
            <GroupCard key={group.key} group={group} onDone={(dismiss) => done(group.key, dismiss)} />
          ))}
        </div>
      ) : null}
    </section>
  );
}
