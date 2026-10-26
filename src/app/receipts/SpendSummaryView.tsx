"use client";

import { useEffect, useMemo, useState } from "react";

export type SpendReceipt = { d: string; t: number; v: string | null };
export type SpendItem = { d: string; c: string; p: number };

type Range = { from: string; to: string }; // inclusive ISO dates; empty string = unbounded

const STORAGE_KEY = "ft_spend_period";

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function monthRange(month: string): Range {
  const [y, m] = month.split("-").map(Number);
  return { from: `${month}-01`, to: iso(new Date(y, m, 0)) };
}

function quickPeriods() {
  const now = new Date();
  const weekAgo = new Date(now);
  weekAgo.setDate(now.getDate() - 6);
  const today = iso(now);
  return [
    { key: "today", label: "Today", range: { from: today, to: "" } },
    { key: "week", label: "This week", range: { from: iso(weekAgo), to: "" } },
    { key: "month", label: "This month", range: { from: `${today.slice(0, 7)}-01`, to: "" } },
    { key: "year", label: "This year", range: { from: `${now.getFullYear()}-01-01`, to: "" } },
    { key: "all", label: "All time", range: { from: "", to: "" } },
  ];
}

function money(n: number) {
  return n >= 10000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toFixed(2)}`;
}

function inRange(date: string, r: Range) {
  return (!r.from || date >= r.from) && (!r.to || date <= r.to);
}

function summarize(receipts: SpendReceipt[], items: SpendItem[], labels: Record<string, string>, r: Range) {
  let total = 0;
  let count = 0;
  const vendors = new Map<string, number>();
  for (const x of receipts) {
    if (!inRange(x.d, r)) continue;
    total += x.t;
    count++;
    if (x.v) vendors.set(x.v, (vendors.get(x.v) ?? 0) + x.t);
  }
  const categories = new Map<string, number>();
  for (const x of items) if (inRange(x.d, r)) categories.set(x.c, (categories.get(x.c) ?? 0) + x.p);
  const rank = (m: Map<string, number>, limit: number, label: (k: string) => string) =>
    [...m.entries()]
      .filter(([, t]) => t > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([key, t]) => ({ key, label: label(key), total: t }));
  return {
    total,
    count,
    vendors: rank(vendors, 10, (k) => k),
    categories: rank(categories, 20, (k) => labels[k] ?? "Other"),
  };
}

type Entry = { key: string; label: string; total: number };

function BarCard({ title, entries }: { title: string; entries: Entry[] }) {
  const max = entries[0]?.total ?? 1;
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{title}</div>
      {entries.length === 0 ? (
        <div className="py-4 text-sm text-zinc-400">Nothing in this period.</div>
      ) : (
        <div className="space-y-2">
          {entries.map((e) => (
            <div key={e.key}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="truncate">{e.label}</span>
                <span className="shrink-0 tabular-nums text-zinc-500 dark:text-zinc-400">{money(e.total)}</span>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                <div
                  className="h-full rounded-full bg-zinc-400 dark:bg-zinc-500"
                  style={{ width: `${max > 0 ? Math.round((e.total / max) * 100) : 0}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const inputClass =
  "rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900";

export function SpendSummaryView({
  receipts,
  items,
  categoryLabels,
}: {
  receipts: SpendReceipt[];
  items: SpendItem[];
  categoryLabels: Record<string, string>;
}) {
  const quick = useMemo(() => quickPeriods(), []);
  const [active, setActive] = useState("all"); // a quick key, "month-pick" or "range"
  const [month, setMonth] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as {
        active: string;
        month?: string;
        from?: string;
        to?: string;
      } | null;
      if (!saved) return;
      // Restoring the saved choice after hydration; reading localStorage during render would mismatch the server HTML.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActive(saved.active);
      setMonth(saved.month ?? "");
      setFrom(saved.from ?? "");
      setTo(saved.to ?? "");
    } catch {
      // fall back to all time
    }
  }, []);

  function choose(next: { active: string; month?: string; from?: string; to?: string }) {
    setActive(next.active);
    if (next.month !== undefined) setMonth(next.month);
    if (next.from !== undefined) setFrom(next.from);
    if (next.to !== undefined) setTo(next.to);
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ active: next.active, month: next.month ?? month, from: next.from ?? from, to: next.to ?? to }),
      );
    } catch {
      // the choice just will not persist
    }
  }

  const activeRange: Range = (() => {
    if (active === "month-pick" && month) return monthRange(month);
    if (active === "range") return { from, to };
    return (quick.find((p) => p.key === active) ?? quick[quick.length - 1]).range;
  })();

  const label = (() => {
    if (active === "month-pick" && month) {
      return new Date(`${month}-01T12:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" });
    }
    if (active === "range") {
      if (from && to) return `${from} to ${to}`;
      if (from) return `since ${from}`;
      if (to) return `through ${to}`;
      return "all time";
    }
    return (quick.find((p) => p.key === active) ?? quick[quick.length - 1]).label.toLowerCase();
  })();

  const cards = useMemo(
    () => quick.map((p) => ({ ...p, ...summarize(receipts, items, categoryLabels, p.range) })),
    [quick, receipts, items, categoryLabels],
  );
  const current = useMemo(
    () => summarize(receipts, items, categoryLabels, activeRange),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [receipts, items, categoryLabels, activeRange.from, activeRange.to],
  );

  const customActive = active === "month-pick" || active === "range";

  return (
    <div className="space-y-3">
      <div role="tablist" className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {cards.map((p) => {
          const selected = p.key === active;
          return (
            <button
              key={p.key}
              role="tab"
              aria-selected={selected}
              type="button"
              onClick={() => choose({ active: p.key })}
              className={`rounded-lg border p-3 text-left transition ${
                selected
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                  : "border-zinc-200 bg-white hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600"
              }`}
            >
              <div className={`text-xs ${selected ? "opacity-70" : "text-zinc-500 dark:text-zinc-400"}`}>{p.label}</div>
              <div className="mt-1 text-xl font-semibold tabular-nums">
                {p.count > 0 ? money(p.total) : <span className="opacity-40">—</span>}
              </div>
              {p.count > 0 && (
                <div className={`mt-0.5 text-xs ${selected ? "opacity-70" : "text-zinc-400"}`}>
                  {p.count} receipt{p.count !== 1 ? "s" : ""}
                </div>
              )}
            </button>
          );
        })}
      </div>

      <div
        className={`flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border px-3 py-2 text-sm ${
          customActive ? "border-zinc-900 dark:border-zinc-100" : "border-zinc-200 dark:border-zinc-800"
        }`}
      >
        <label className="flex items-center gap-2">
          <span className="text-zinc-500">Month</span>
          <input
            type="month"
            value={month}
            onChange={(e) => choose(e.target.value ? { active: "month-pick", month: e.target.value } : { active: "all", month: "" })}
            className={inputClass}
          />
        </label>
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-zinc-500">Range</span>
          <input
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => choose({ active: "range", from: e.target.value })}
            className={inputClass}
            aria-label="From date"
          />
          <span className="text-zinc-400">to</span>
          <input
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => choose({ active: "range", to: e.target.value })}
            className={inputClass}
            aria-label="To date"
          />
        </span>
        {customActive && (
          <span className="ml-auto flex items-center gap-3 text-xs text-zinc-500">
            <span className="tabular-nums">
              {current.count} receipt{current.count !== 1 ? "s" : ""} · {money(current.total)}
            </span>
            <button type="button" onClick={() => choose({ active: "all" })} className="underline hover:text-zinc-800 dark:hover:text-zinc-200">
              Clear
            </button>
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <BarCard title={`By vendor · ${label}`} entries={current.vendors} />
        <BarCard title={`By category · ${label}`} entries={current.categories} />
      </div>
    </div>
  );
}
