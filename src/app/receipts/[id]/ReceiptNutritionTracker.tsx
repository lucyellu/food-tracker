"use client";

import { useMemo, useState } from "react";

type ConsumptionStatus =
  | "available"
  | "pantry"
  | "fridge"
  | "consumed"
  | "disposed"
  | "unavailable"
  | "refunded";
type ViewMode = "table" | "pantry" | "consumed" | "calendar";
type RateMode = "total" | "day" | "person" | "personDay" | "serving" | "hundredG";

type NutritionMeta = {
  basis?: string;
  dataType?: string;
  serving?: { estimatedServings?: number | null };
  per100g?: {
    calories?: number | null;
    proteinG?: number | null;
    carbsG?: number | null;
    fatG?: number | null;
    fiberG?: number | null;
    sugarG?: number | null;
    sodiumMg?: number | null;
  };
  per100gMinerals?: {
    calciumMg?: number | null;
    ironMg?: number | null;
    magnesiumMg?: number | null;
    potassiumMg?: number | null;
    sodiumMg?: number | null;
  };
};

type Nutrition = {
  totalGrams: number | null;
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  fiberG: number | null;
  sugarG: number | null;
  sodiumMg: number | null;
  mineralsJson: string | null;
  vitaminsJson: string | null;
  activeIngredientsJson: string | null;
};

export type ReceiptTrackerItem = {
  id: number;
  rawName: string;
  normalizedName: string | null;
  quantity: number;
  unit: string;
  price: number | null;
  retailerSku: string | null;
  productSource: string | null;
  productUrl: string | null;
  productImageUrl: string | null;
  nutritionStatus: string;
  consumptionStatus: ConsumptionStatus;
  statusDate: string | null;
  nutrition: Nutrition | null;
};

type Totals = {
  price: number;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  sugarG: number;
  fiberG: number;
  sodiumMg: number;
  potassiumMg: number;
  magnesiumMg: number;
  calciumMg: number;
  ironMg: number;
  totalGrams: number;
  servings: number;
  knownItems: number;
  itemCount: number;
};

const STATUS_OPTIONS: ConsumptionStatus[] = [
  "available",
  "pantry",
  "fridge",
  "consumed",
  "disposed",
  "unavailable",
  "refunded",
];

const STATUS_META: Record<ConsumptionStatus, { label: string; className: string }> = {
  available: { label: "Available", className: "border-zinc-200 dark:border-zinc-700" },
  pantry: { label: "Pantry", className: "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30" },
  fridge: { label: "Fridge", className: "border-cyan-300 bg-cyan-50 dark:border-cyan-900 dark:bg-cyan-950/30" },
  consumed: { label: "Consumed", className: "border-green-300 bg-green-50 dark:border-green-900 dark:bg-green-950/40" },
  disposed: { label: "Disposed", className: "border-red-300 bg-red-50 opacity-70 dark:border-red-900 dark:bg-red-950/30" },
  unavailable: {
    label: "Unavailable",
    className: "border-orange-300 bg-orange-50 opacity-80 dark:border-orange-900 dark:bg-orange-950/30",
  },
  refunded: { label: "Refunded", className: "border-purple-300 bg-purple-50 opacity-75 dark:border-purple-900 dark:bg-purple-950/30" },
};

const DAILY_VALUES = {
  calories: 2000,
  fatG: 78,
  carbsG: 275,
  fiberG: 28,
  proteinG: 50,
  addedSugarG: 50,
  sodiumMg: 2300,
  potassiumMg: 4700,
  calciumMg: 1300,
  ironMg: 18,
  magnesiumMg: 420,
};

function formatMoney(n: number | null | undefined) {
  if (n == null) return "-";
  return `$${n.toFixed(2)}`;
}

function formatNumber(n: number | null | undefined, digits = 0) {
  if (n == null || !Number.isFinite(n)) return "-";
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function parseMeta(meta: string | null | undefined): NutritionMeta | null {
  if (!meta) return null;
  try {
    return JSON.parse(meta) as NutritionMeta;
  } catch {
    return null;
  }
}

function parseJsonRecord(value: string | null | undefined) {
  if (!value) return {};
  try {
    return JSON.parse(value) as Record<string, number>;
  } catch {
    return {};
  }
}

function mineralValue(mineralsJson: string | null | undefined, name: string) {
  const minerals = parseJsonRecord(mineralsJson);
  const match = Object.entries(minerals).find(([key]) => key.toLowerCase().includes(name));
  return match?.[1] ?? null;
}

function sodiumToSaltG(sodiumMg: number | null | undefined) {
  return sodiumMg == null ? null : (sodiumMg * 2.542) / 1000;
}

function formatMg(mg: number | null | undefined) {
  if (mg == null || !Number.isFinite(mg)) return "-";
  if (mg >= 1000) return `${formatNumber(mg / 1000, 2)}g`;
  return `${formatNumber(mg)}mg`;
}

function formatMassG(grams: number | null | undefined) {
  if (grams == null) return "per 100g";
  if (grams >= 1000) return `${formatNumber(grams / 1000, 2)} kg`;
  return `${formatNumber(grams, grams < 10 ? 1 : 0)} g`;
}

function isVolumeItem(rawName: string, unit: string) {
  return (
    /\d+(?:\.\d+)?\s*(?:mL|ml|L|l|fl_oz|fl\s*oz)\b/.test(rawName) ||
    ["ml", "l", "fl_oz"].includes(unit)
  );
}

function formatNormalizedAmount(rawName: string, unit: string, grams: number | null | undefined) {
  if (grams == null) return "per 100g";
  if (isVolumeItem(rawName, unit)) {
    return grams >= 1000 ? `${formatNumber(grams / 1000, 2)} L est.` : `${formatNumber(grams)} mL est.`;
  }
  return formatMassG(grams);
}

function percentDv(value: number | null | undefined, dailyValue: number) {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${formatNumber((value / dailyValue) * 100)}% DV`;
}

function addDaysToIso(iso: string, days: number) {
  const date = new Date(`${iso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function rowValues(item: ReceiptTrackerItem) {
  const meta = parseMeta(item.nutrition?.activeIngredientsJson);
  const per100gOnly = meta?.basis === "per_100g_reference_only";
  const n = item.nutrition;

  return {
    meta,
    per100gOnly,
    calories: per100gOnly ? meta?.per100g?.calories : n?.calories,
    proteinG: per100gOnly ? meta?.per100g?.proteinG : n?.proteinG,
    carbsG: per100gOnly ? meta?.per100g?.carbsG : n?.carbsG,
    fatG: per100gOnly ? meta?.per100g?.fatG : n?.fatG,
    sugarG: per100gOnly ? meta?.per100g?.sugarG : n?.sugarG,
    fiberG: per100gOnly ? meta?.per100g?.fiberG : n?.fiberG,
    sodiumMg: per100gOnly
      ? (meta?.per100gMinerals?.sodiumMg ?? meta?.per100g?.sodiumMg)
      : n?.sodiumMg,
    potassiumMg: per100gOnly
      ? meta?.per100gMinerals?.potassiumMg
      : mineralValue(n?.mineralsJson, "potassium"),
    magnesiumMg: per100gOnly
      ? meta?.per100gMinerals?.magnesiumMg
      : mineralValue(n?.mineralsJson, "magnesium"),
    calciumMg: per100gOnly
      ? meta?.per100gMinerals?.calciumMg
      : mineralValue(n?.mineralsJson, "calcium"),
    ironMg: per100gOnly ? meta?.per100gMinerals?.ironMg : mineralValue(n?.mineralsJson, "iron"),
  };
}

function emptyTotals(): Totals {
  return {
    price: 0,
    calories: 0,
    proteinG: 0,
    carbsG: 0,
    fatG: 0,
    sugarG: 0,
    fiberG: 0,
    sodiumMg: 0,
    potassiumMg: 0,
    magnesiumMg: 0,
    calciumMg: 0,
    ironMg: 0,
    totalGrams: 0,
    servings: 0,
    knownItems: 0,
    itemCount: 0,
  };
}

function computeTotals(items: ReceiptTrackerItem[]): Totals {
  return items.reduce((acc, item) => {
    const values = rowValues(item);
    const servings = values.meta?.serving?.estimatedServings ?? 0;
    acc.itemCount += 1;
    acc.price += item.price ?? 0;
    acc.servings += servings;
    if (!item.nutrition?.totalGrams) return acc;
    acc.knownItems += 1;
    acc.totalGrams += item.nutrition.totalGrams;
    acc.calories += item.nutrition.calories ?? 0;
    acc.proteinG += item.nutrition.proteinG ?? 0;
    acc.carbsG += item.nutrition.carbsG ?? 0;
    acc.fatG += item.nutrition.fatG ?? 0;
    acc.sugarG += item.nutrition.sugarG ?? 0;
    acc.fiberG += item.nutrition.fiberG ?? 0;
    acc.sodiumMg += item.nutrition.sodiumMg ?? 0;
    acc.potassiumMg += values.potassiumMg ?? 0;
    acc.magnesiumMg += values.magnesiumMg ?? 0;
    acc.calciumMg += values.calciumMg ?? 0;
    acc.ironMg += values.ironMg ?? 0;
    return acc;
  }, emptyTotals());
}

function scaleTotals(totals: Totals, divisor: number | null): Totals {
  if (!divisor || divisor <= 0) return emptyTotals();
  return {
    price: totals.price / divisor,
    calories: totals.calories / divisor,
    proteinG: totals.proteinG / divisor,
    carbsG: totals.carbsG / divisor,
    fatG: totals.fatG / divisor,
    sugarG: totals.sugarG / divisor,
    fiberG: totals.fiberG / divisor,
    sodiumMg: totals.sodiumMg / divisor,
    potassiumMg: totals.potassiumMg / divisor,
    magnesiumMg: totals.magnesiumMg / divisor,
    calciumMg: totals.calciumMg / divisor,
    ironMg: totals.ironMg / divisor,
    totalGrams: totals.totalGrams / divisor,
    servings: totals.servings / divisor,
    knownItems: totals.knownItems,
    itemCount: totals.itemCount,
  };
}

function rateDivisor(mode: RateMode, totals: Totals, people: number, days: number) {
  if (mode === "day") return Math.max(days, 1);
  if (mode === "person") return Math.max(people, 1);
  if (mode === "personDay") return Math.max(people, 1) * Math.max(days, 1);
  if (mode === "serving") return totals.servings > 0 ? totals.servings : null;
  if (mode === "hundredG") return totals.totalGrams > 0 ? totals.totalGrams / 100 : null;
  return 1;
}

function rateLabel(mode: RateMode) {
  const labels: Record<RateMode, string> = {
    total: "Total",
    day: "Per day",
    person: "Per person",
    personDay: "Per person-day",
    serving: "Per estimated serving",
    hundredG: "Per 100g",
  };
  return labels[mode];
}

function SummaryCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
      {sub ? <div className="mt-1 text-xs text-zinc-500">{sub}</div> : null}
    </div>
  );
}

function NutrientCard({
  label,
  value,
  unit,
  dv,
  digits = 0,
}: {
  label: string;
  value: number | null | undefined;
  unit: string;
  dv?: number;
  digits?: number;
}) {
  const display = value == null ? "-" : `${formatNumber(value, digits)}${unit}`;
  return <SummaryCard label={label} value={display} sub={dv ? percentDv(value, dv) : undefined} />;
}

function isTrackedForPlan(item: ReceiptTrackerItem) {
  return !["disposed", "unavailable", "refunded"].includes(item.consumptionStatus);
}

function isPantryStatus(item: ReceiptTrackerItem) {
  return ["available", "pantry", "fridge"].includes(item.consumptionStatus);
}

export function ReceiptNutritionTracker({
  receiptId,
  initialItems,
  purchasedAt,
}: {
  receiptId: number;
  initialItems: ReceiptTrackerItem[];
  purchasedAt: string | null;
}) {
  const startDate = purchasedAt && /^\d{4}-\d{2}-\d{2}$/.test(purchasedAt) ? purchasedAt : todayIso();
  const [items, setItems] = useState(initialItems);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [people, setPeople] = useState(4);
  const [days, setDays] = useState(7);
  const [view, setView] = useState<ViewMode>("table");
  const [selectedRate, setSelectedRate] = useState<RateMode>("total");
  const [statusDate, setStatusDate] = useState(startDate);
  const [saving, setSaving] = useState(false);

  const planEnd = addDaysToIso(startDate, Math.max(days, 1));
  const trackedItems = useMemo(() => items.filter(isTrackedForPlan), [items]);
  const selectedItems = useMemo(
    () => items.filter((item) => selectedIds.has(item.id)),
    [items, selectedIds],
  );
  const visibleItems = useMemo(() => {
    if (view === "pantry") return items.filter(isPantryStatus);
    if (view === "consumed") return items.filter((item) => item.consumptionStatus === "consumed");
    return items;
  }, [items, view]);
  const trackedTotals = useMemo(() => computeTotals(trackedItems), [trackedItems]);
  const dailyPersonTotals = useMemo(
    () => scaleTotals(trackedTotals, Math.max(people, 1) * Math.max(days, 1)),
    [trackedTotals, people, days],
  );
  const selectedTotals = useMemo(() => computeTotals(selectedItems), [selectedItems]);
  const selectedScaledTotals = useMemo(
    () => scaleTotals(selectedTotals, rateDivisor(selectedRate, selectedTotals, people, days)),
    [selectedTotals, selectedRate, people, days],
  );
  const allTotals = useMemo(() => computeTotals(items), [items]);
  const statusCounts = useMemo(
    () =>
      items.reduce(
        (acc, item) => {
          acc[item.consumptionStatus] += 1;
          return acc;
        },
        {
          available: 0,
          pantry: 0,
          fridge: 0,
          consumed: 0,
          disposed: 0,
          unavailable: 0,
          refunded: 0,
        } as Record<ConsumptionStatus, number>,
      ),
    [items],
  );
  const calendarDays = useMemo(
    () => Array.from({ length: Math.max(days, 1) }, (_, index) => addDaysToIso(startDate, index)),
    [days, startDate],
  );
  const visibleIds = useMemo(() => visibleItems.map((item) => item.id), [visibleItems]);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const unknownNutritionRows = allTotals.itemCount - allTotals.knownItems - statusCounts.refunded;
  const selectedDenominator = rateDivisor(selectedRate, selectedTotals, people, days);

  function toggleSelected(id: number) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function setStatus(ids: number[], status: ConsumptionStatus, date = statusDate) {
    if (ids.length === 0) return;
    setSaving(true);
    const nextDate = status === "consumed" || status === "disposed" ? date : null;
    const previous = items;
    setItems((current) =>
      current.map((item) =>
        ids.includes(item.id) ? { ...item, consumptionStatus: status, statusDate: nextDate } : item,
      ),
    );
    try {
      const res = await fetch(`/api/receipts/${receiptId}/items`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemIds: ids, status, statusDate: nextDate }),
      });
      if (!res.ok) setItems(previous);
    } finally {
      setSaving(false);
    }
  }

  function selectAllVisible() {
    setSelectedIds(new Set(visibleIds));
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  function renderItemsTable(tableItems: ReceiptTrackerItem[]) {
    const tableTotals = computeTotals(tableItems);

    return (
      <div className="h-[72vh] overflow-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-zinc-50 text-left text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
            <tr>
              <th className="w-10 px-4 py-3 font-medium">
                <input
                  type="checkbox"
                  aria-label="Select visible items"
                  checked={allVisibleSelected}
                  onChange={(e) => (e.target.checked ? selectAllVisible() : clearSelection())}
                />
              </th>
              <th className="px-4 py-3 font-medium">Item</th>
              <th className="px-4 py-3 font-medium">Tag</th>
              <th className="px-4 py-3 font-medium">Amount</th>
              <th className="px-4 py-3 text-right font-medium">Price</th>
              <th className="px-4 py-3 text-right font-medium">Calories</th>
              <th className="px-4 py-3 font-medium">Macros</th>
              <th className="px-4 py-3 font-medium">Sugar & fiber</th>
              <th className="px-4 py-3 font-medium">Electrolytes</th>
              <th className="px-4 py-3 font-medium">Source</th>
            </tr>
          </thead>
          <tbody>
            {tableItems.map((item) => {
              const values = rowValues(item);
              const selected = selectedIds.has(item.id);
              const serving = values.meta?.serving;

              return (
                <tr
                  key={item.id}
                  className={`border-t border-zinc-100 dark:border-zinc-800 ${STATUS_META[item.consumptionStatus].className} ${
                    selected ? "outline outline-2 outline-zinc-900 dark:outline-zinc-100" : ""
                  }`}
                >
                  <td className="px-4 py-3 align-top">
                    <input
                      type="checkbox"
                      aria-label={`Select ${item.rawName}`}
                      checked={selected}
                      onChange={() => toggleSelected(item.id)}
                    />
                  </td>
                  <td className="px-4 py-3 align-top font-medium">
                    <div className="flex min-w-72 items-start gap-3">
                      {item.productImageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.productImageUrl}
                          alt=""
                          className="h-14 w-14 rounded-md border border-zinc-200 bg-zinc-50 object-cover dark:border-zinc-800 dark:bg-zinc-950"
                          loading="lazy"
                        />
                      ) : (
                        <div className="h-14 w-14 rounded-md border border-dashed border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950" />
                      )}
                      <div>
                        <div>{item.rawName}</div>
                        {item.normalizedName ? (
                          <div className="mt-1 text-xs text-zinc-500">{item.normalizedName}</div>
                        ) : null}
                        <div className="mt-1 text-xs text-zinc-500">
                          {item.productUrl ? (
                            <a
                              href={item.productUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="hover:underline"
                            >
                              {item.productSource ? `View on ${item.productSource}` : "View product"}
                            </a>
                          ) : (
                            "No product listing yet"
                          )}
                          {item.retailerSku ? ` · SKU ${item.retailerSku}` : ""}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <select
                      value={item.consumptionStatus}
                      disabled={saving}
                      onChange={(e) => setStatus([item.id], e.target.value as ConsumptionStatus, item.statusDate ?? statusDate)}
                      className="w-32 rounded-md border border-zinc-200 bg-transparent px-2 py-1 text-xs dark:border-zinc-800"
                    >
                      {STATUS_OPTIONS.map((status) => (
                        <option key={status} value={status}>
                          {STATUS_META[status].label}
                        </option>
                      ))}
                    </select>
                    {item.consumptionStatus === "consumed" || item.consumptionStatus === "disposed" ? (
                      <input
                        type="date"
                        value={item.statusDate ?? statusDate}
                        onChange={(e) => setStatus([item.id], item.consumptionStatus, e.target.value)}
                        className="mt-2 w-32 rounded-md border border-zinc-200 bg-transparent px-2 py-1 text-xs dark:border-zinc-800"
                      />
                    ) : null}
                  </td>
                  <td className="px-4 py-3 align-top text-xs text-zinc-600 dark:text-zinc-400">
                    <div>{formatNormalizedAmount(item.rawName, item.unit, item.nutrition?.totalGrams)}</div>
                    <div className="mt-1 text-zinc-500">
                      {formatNumber(item.quantity, 2)} {item.unit}
                    </div>
                    {serving?.estimatedServings ? (
                      <div className="mt-1 text-zinc-500">
                        {formatNumber(serving.estimatedServings, 1)} servings
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-right align-top">{formatMoney(item.price)}</td>
                  <td className="px-4 py-3 text-right align-top">
                    {formatNumber(values.calories)}
                    {values.per100gOnly && values.calories != null ? (
                      <span className="text-xs text-zinc-500"> /100g</span>
                    ) : null}
                    <div className="mt-1 text-xs text-zinc-500">
                      {percentDv(values.calories, DAILY_VALUES.calories)}
                    </div>
                  </td>
                  <td className="px-4 py-3 align-top text-xs text-zinc-600 dark:text-zinc-400">
                    P {formatNumber(values.proteinG, 1)}g ({percentDv(values.proteinG, DAILY_VALUES.proteinG)})
                    <div className="mt-1">
                      C {formatNumber(values.carbsG, 1)}g ({percentDv(values.carbsG, DAILY_VALUES.carbsG)})
                    </div>
                    <div className="mt-1">
                      F {formatNumber(values.fatG, 1)}g ({percentDv(values.fatG, DAILY_VALUES.fatG)})
                    </div>
                  </td>
                  <td className="px-4 py-3 align-top text-xs text-zinc-600 dark:text-zinc-400">
                    Sugar {formatNumber(values.sugarG, 1)}g
                    <div className="mt-1 text-zinc-500">
                      Fiber {formatNumber(values.fiberG, 1)}g ({percentDv(values.fiberG, DAILY_VALUES.fiberG)})
                    </div>
                    <div className="mt-1 text-zinc-500">Total sugar has no FDA %DV</div>
                  </td>
                  <td className="px-4 py-3 align-top text-xs text-zinc-600 dark:text-zinc-400">
                    Na {formatMg(values.sodiumMg)} ({percentDv(values.sodiumMg, DAILY_VALUES.sodiumMg)})
                    <div className="mt-1 text-zinc-500">
                      Salt {formatNumber(sodiumToSaltG(values.sodiumMg), 2)}g · K {formatMg(values.potassiumMg)} (
                      {percentDv(values.potassiumMg, DAILY_VALUES.potassiumMg)})
                    </div>
                    <div className="mt-1 text-zinc-500">
                      Mg {formatMg(values.magnesiumMg)} ({percentDv(values.magnesiumMg, DAILY_VALUES.magnesiumMg)}) ·
                      Ca {formatMg(values.calciumMg)} ({percentDv(values.calciumMg, DAILY_VALUES.calciumMg)})
                    </div>
                  </td>
                  <td className="px-4 py-3 align-top text-xs">
                    <span
                      className={
                        item.nutritionStatus === "matched"
                          ? "text-green-600"
                          : item.nutritionStatus === "unmatched"
                            ? "text-amber-600"
                            : "text-zinc-500"
                      }
                    >
                      {item.nutritionStatus}
                    </span>
                    {values.meta?.dataType ? <div className="mt-1 text-zinc-500">{values.meta.dataType}</div> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="sticky bottom-0 z-10 bg-zinc-50 text-sm shadow-[0_-1px_0_rgba(0,0,0,0.08)] dark:bg-zinc-800">
            <tr>
              <td className="px-4 py-3"></td>
              <td className="px-4 py-3 font-medium">All visible total</td>
              <td className="px-4 py-3 text-xs">{tableItems.length} rows</td>
              <td className="px-4 py-3 text-xs">{tableTotals.knownItems} nutrition totals</td>
              <td className="px-4 py-3 text-right font-medium">{formatMoney(tableTotals.price)}</td>
              <td className="px-4 py-3 text-right font-medium">{formatNumber(tableTotals.calories)}</td>
              <td className="px-4 py-3 text-xs">
                P {formatNumber(tableTotals.proteinG)}g · C {formatNumber(tableTotals.carbsG)}g · F{" "}
                {formatNumber(tableTotals.fatG)}g
              </td>
              <td className="px-4 py-3 text-xs">
                Sugar {formatNumber(tableTotals.sugarG)}g · Fiber {formatNumber(tableTotals.fiberG)}g
              </td>
              <td className="px-4 py-3 text-xs">
                Salt {formatNumber(sodiumToSaltG(tableTotals.sodiumMg), 1)}g · K{" "}
                {formatMg(tableTotals.potassiumMg)}
              </td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <SummaryCard
          label="Tracked rows"
          value={`${trackedTotals.itemCount}`}
          sub={`${trackedTotals.knownItems} with nutrition totals`}
        />
        <SummaryCard label="Plan range" value={`${startDate}`} sub={`to ${planEnd}`} />
        <NutrientCard
          label="Daily calories / person"
          value={dailyPersonTotals.calories}
          unit=""
          dv={DAILY_VALUES.calories}
        />
        <NutrientCard
          label="Daily protein / person"
          value={dailyPersonTotals.proteinG}
          unit="g"
          dv={DAILY_VALUES.proteinG}
        />
        <NutrientCard
          label="Daily carbs / person"
          value={dailyPersonTotals.carbsG}
          unit="g"
          dv={DAILY_VALUES.carbsG}
        />
        <NutrientCard
          label="Daily fat / person"
          value={dailyPersonTotals.fatG}
          unit="g"
          dv={DAILY_VALUES.fatG}
        />
        <NutrientCard
          label="Daily sodium / person"
          value={dailyPersonTotals.sodiumMg}
          unit="mg"
          dv={DAILY_VALUES.sodiumMg}
        />
        <NutrientCard
          label="Daily potassium / person"
          value={dailyPersonTotals.potassiumMg}
          unit="mg"
          dv={DAILY_VALUES.potassiumMg}
        />
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-xs text-zinc-500">People</span>
            <input
              type="number"
              min={1}
              value={people}
              onChange={(e) => setPeople(Math.max(Number(e.target.value) || 1, 1))}
              className="w-20 rounded-md border border-zinc-200 bg-transparent px-2 py-1 dark:border-zinc-800"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-zinc-500">Days</span>
            <input
              type="number"
              min={1}
              value={days}
              onChange={(e) => setDays(Math.max(Number(e.target.value) || 1, 1))}
              className="w-20 rounded-md border border-zinc-200 bg-transparent px-2 py-1 dark:border-zinc-800"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-zinc-500">Status date</span>
            <input
              type="date"
              value={statusDate}
              onChange={(e) => setStatusDate(e.target.value)}
              className="rounded-md border border-zinc-200 bg-transparent px-2 py-1 dark:border-zinc-800"
            />
          </label>
          <div className="text-xs text-zinc-500">
            Range is {startDate} to {planEnd}. Plan totals exclude disposed, unavailable, and refunded rows.
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {STATUS_OPTIONS.map((status) => (
            <span key={status} className="rounded-full bg-zinc-100 px-2 py-1 dark:bg-zinc-800">
              {STATUS_META[status].label}: {statusCounts[status]}
            </span>
          ))}
          <span className="rounded-full bg-zinc-100 px-2 py-1 dark:bg-zinc-800">
            No quantity nutrition: {Math.max(unknownNutritionRows, 0)}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {(["table", "pantry", "consumed", "calendar"] as ViewMode[]).map((nextView) => (
          <button
            key={nextView}
            type="button"
            onClick={() => setView(nextView)}
            className={`rounded-md border px-3 py-2 text-sm font-medium ${
              view === nextView
                ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950"
                : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
            }`}
          >
            {nextView === "table" ? "All items" : nextView === "pantry" ? "Pantry/fridge" : nextView === "consumed" ? "Consumed" : "Calendar"}
          </button>
        ))}
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        {view === "calendar" ? (
          <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {calendarDays.map((day) => {
              const dayItems = items.filter(
                (item) => item.consumptionStatus === "consumed" && item.statusDate === day,
              );
              const dayTotals = computeTotals(dayItems);
              return (
                <section
                  key={day}
                  className="min-h-44 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">{day}</div>
                      <div className="mt-1 text-xs text-zinc-500">{dayItems.length} consumed rows</div>
                    </div>
                    <div className="text-right text-xs text-zinc-500">
                      <div>{formatNumber(dayTotals.calories)} cal</div>
                      <div>{formatNumber(dayTotals.proteinG)}g protein</div>
                    </div>
                  </div>
                  <div className="mt-3 space-y-2">
                    {dayItems.length === 0 ? (
                      <div className="text-sm text-zinc-500">No consumed items logged.</div>
                    ) : (
                      dayItems.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => toggleSelected(item.id)}
                          className="block w-full rounded-md border border-zinc-200 px-3 py-2 text-left text-xs hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800"
                        >
                          <span className="font-medium">{item.rawName}</span>
                          <span className="mt-1 block text-zinc-500">
                            {formatNumber(item.nutrition?.calories)} cal · {formatMoney(item.price)}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        ) : (
          renderItemsTable(visibleItems)
        )}

        <aside className="h-[72vh] space-y-4 overflow-auto rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900 xl:sticky xl:top-4">
          <div>
            <div className="text-sm font-semibold">Selected items</div>
            <div className="mt-1 text-xs text-zinc-500">
              {selectedTotals.itemCount} selected · {selectedTotals.knownItems} with nutrition totals ·{" "}
              {formatNumber(selectedTotals.servings, 1)} servings · {formatMassG(selectedTotals.totalGrams)}
            </div>
          </div>
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-zinc-500">Selected total basis</span>
            <select
              value={selectedRate}
              onChange={(e) => setSelectedRate(e.target.value as RateMode)}
              className="w-full rounded-md border border-zinc-200 bg-transparent px-2 py-2 text-sm dark:border-zinc-800"
            >
              {(["total", "day", "person", "personDay", "serving", "hundredG"] as RateMode[]).map((mode) => (
                <option key={mode} value={mode}>
                  {rateLabel(mode)}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-zinc-500">
              {selectedDenominator ? `Showing ${rateLabel(selectedRate).toLowerCase()}.` : "This basis needs serving or weight data."}
            </span>
          </label>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <NutrientCard
              label="Calories"
              value={selectedScaledTotals.calories}
              unit=""
              dv={DAILY_VALUES.calories}
            />
            <SummaryCard label="Price" value={formatMoney(selectedScaledTotals.price)} />
            <NutrientCard
              label="Protein"
              value={selectedScaledTotals.proteinG}
              unit="g"
              dv={DAILY_VALUES.proteinG}
            />
            <NutrientCard label="Carbs" value={selectedScaledTotals.carbsG} unit="g" dv={DAILY_VALUES.carbsG} />
            <NutrientCard label="Fat" value={selectedScaledTotals.fatG} unit="g" dv={DAILY_VALUES.fatG} />
            <NutrientCard label="Fiber" value={selectedScaledTotals.fiberG} unit="g" dv={DAILY_VALUES.fiberG} />
            <SummaryCard
              label="Sugar"
              value={`${formatNumber(selectedScaledTotals.sugarG)}g`}
              sub="Total sugar has no FDA %DV"
            />
            <SummaryCard
              label="Salt"
              value={`${formatNumber(sodiumToSaltG(selectedScaledTotals.sodiumMg), 1)}g`}
              sub={percentDv(selectedScaledTotals.sodiumMg, DAILY_VALUES.sodiumMg)}
            />
            <NutrientCard
              label="Potassium"
              value={selectedScaledTotals.potassiumMg}
              unit="mg"
              dv={DAILY_VALUES.potassiumMg}
            />
            <NutrientCard
              label="Calcium"
              value={selectedScaledTotals.calciumMg}
              unit="mg"
              dv={DAILY_VALUES.calciumMg}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            {STATUS_OPTIONS.map((status) => (
              <button
                key={status}
                type="button"
                disabled={selectedIds.size === 0 || saving}
                onClick={() => setStatus(Array.from(selectedIds), status)}
                className="rounded-md border border-zinc-200 px-3 py-2 text-xs font-medium hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:hover:bg-zinc-800"
              >
                Mark {STATUS_META[status].label.toLowerCase()}
              </button>
            ))}
            <button
              type="button"
              onClick={clearSelection}
              className="rounded-md px-3 py-2 text-xs text-zinc-500 hover:underline"
            >
              Clear
            </button>
          </div>
          <div className="text-xs text-zinc-500">
            The 44 receipt rows include fulfilled, refunded, and unmatched rows. Nutrition totals only count rows with
            both a USDA match and enough size data to estimate the whole item.
          </div>
        </aside>
      </div>
    </div>
  );
}
