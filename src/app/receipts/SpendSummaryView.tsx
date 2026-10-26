"use client";

import { useEffect, useState } from "react";

export type BarEntry = { key: string; label: string; total: number };
export type PeriodData = {
  key: string;
  label: string;
  total: number;
  count: number;
  vendors: BarEntry[];
  categories: BarEntry[];
};

const STORAGE_KEY = "ft_spend_period";

function money(n: number) {
  return n >= 10000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toFixed(2)}`;
}

function BarRow({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="truncate">{label}</span>
        <span className="shrink-0 tabular-nums text-zinc-500 dark:text-zinc-400">{money(value)}</span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        <div className="h-full rounded-full bg-zinc-400 dark:bg-zinc-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function BarCard({ title, entries }: { title: string; entries: BarEntry[] }) {
  const max = entries[0]?.total ?? 1;
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{title}</div>
      {entries.length === 0 ? (
        <div className="py-4 text-sm text-zinc-400">Nothing in this period.</div>
      ) : (
        <div className="space-y-2">
          {entries.map((e) => (
            <BarRow key={e.key} label={e.label} value={e.total} max={max} />
          ))}
        </div>
      )}
    </div>
  );
}

export function SpendSummaryView({ periods }: { periods: PeriodData[] }) {
  const [active, setActive] = useState("all");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && periods.some((p) => p.key === saved)) setActive(saved);
    } catch {
      // fall back to all time
    }
  }, [periods]);

  function choose(key: string) {
    setActive(key);
    try {
      localStorage.setItem(STORAGE_KEY, key);
    } catch {
      // the choice just will not persist
    }
  }

  const period = periods.find((p) => p.key === active) ?? periods[periods.length - 1];

  return (
    <div className="space-y-3">
      <div role="tablist" className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {periods.map((p) => {
          const selected = p.key === period.key;
          return (
            <button
              key={p.key}
              role="tab"
              aria-selected={selected}
              type="button"
              onClick={() => choose(p.key)}
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

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <BarCard title={`By vendor · ${period.label.toLowerCase()}`} entries={period.vendors} />
        <BarCard title={`By category · ${period.label.toLowerCase()}`} entries={period.categories} />
      </div>
    </div>
  );
}
