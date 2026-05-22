"use client";

import { useMemo, useState } from "react";

type ConsumptionStatus = "available" | "consumed" | "disposed";

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
  knownItems: number;
  itemCount: number;
};

function formatMoney(n: number | null | undefined) {
  if (n == null) return "-";
  return `$${n.toFixed(2)}`;
}

function formatNumber(n: number | null | undefined, digits = 0) {
  if (n == null) return "-";
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
  if (mg == null) return "-";
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
  };
}

function computeTotals(items: ReceiptTrackerItem[]): Totals {
  return items.reduce(
    (acc, item) => {
      const values = rowValues(item);
      acc.itemCount += 1;
      acc.price += item.price ?? 0;
      if (!item.nutrition?.totalGrams) return acc;
      acc.knownItems += 1;
      acc.calories += item.nutrition.calories ?? 0;
      acc.proteinG += item.nutrition.proteinG ?? 0;
      acc.carbsG += item.nutrition.carbsG ?? 0;
      acc.fatG += item.nutrition.fatG ?? 0;
      acc.sugarG += item.nutrition.sugarG ?? 0;
      acc.fiberG += item.nutrition.fiberG ?? 0;
      acc.sodiumMg += item.nutrition.sodiumMg ?? 0;
      acc.potassiumMg += values.potassiumMg ?? 0;
      return acc;
    },
    {
      price: 0,
      calories: 0,
      proteinG: 0,
      carbsG: 0,
      fatG: 0,
      sugarG: 0,
      fiberG: 0,
      sodiumMg: 0,
      potassiumMg: 0,
      knownItems: 0,
      itemCount: 0,
    },
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-3">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="text-xl font-semibold mt-1">{value}</div>
    </div>
  );
}

const statusClass: Record<ConsumptionStatus, string> = {
  available: "border-zinc-200 dark:border-zinc-700",
  consumed: "border-green-300 bg-green-50 dark:border-green-900 dark:bg-green-950/40",
  disposed: "border-red-300 bg-red-50 opacity-70 dark:border-red-900 dark:bg-red-950/30",
};

export function ReceiptNutritionTracker({
  receiptId,
  initialItems,
}: {
  receiptId: number;
  initialItems: ReceiptTrackerItem[];
}) {
  const [items, setItems] = useState(initialItems);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [people, setPeople] = useState(4);
  const [days, setDays] = useState(7);
  const [saving, setSaving] = useState(false);

  const includedItems = useMemo(
    () => items.filter((item) => item.consumptionStatus !== "disposed"),
    [items],
  );
  const selectedItems = useMemo(
    () => items.filter((item) => selectedIds.has(item.id)),
    [items, selectedIds],
  );
  const includedTotals = useMemo(() => computeTotals(includedItems), [includedItems]);
  const selectedTotals = useMemo(() => computeTotals(selectedItems), [selectedItems]);
  const allTotals = useMemo(() => computeTotals(items), [items]);
  const divisor = Math.max(people, 1) * Math.max(days, 1);

  function toggleSelected(id: number) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function setStatus(ids: number[], status: ConsumptionStatus) {
    if (ids.length === 0) return;
    setSaving(true);
    const previous = items;
    setItems((current) =>
      current.map((item) => (ids.includes(item.id) ? { ...item, consumptionStatus: status } : item)),
    );
    try {
      const res = await fetch(`/api/receipts/${receiptId}/items`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemIds: ids, status }),
      });
      if (!res.ok) {
        setItems(previous);
      }
    } finally {
      setSaving(false);
    }
  }

  function selectAllVisible() {
    setSelectedIds(new Set(items.map((item) => item.id)));
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        <SummaryCard label="Included items" value={`${includedTotals.knownItems}`} />
        <SummaryCard label="Daily calories / person" value={formatNumber(includedTotals.calories / divisor)} />
        <SummaryCard label="Daily protein / person" value={`${formatNumber(includedTotals.proteinG / divisor)}g`} />
        <SummaryCard label="Daily carbs / person" value={`${formatNumber(includedTotals.carbsG / divisor)}g`} />
        <SummaryCard label="Daily fat / person" value={`${formatNumber(includedTotals.fatG / divisor)}g`} />
        <SummaryCard label="Daily sugar / person" value={`${formatNumber(includedTotals.sugarG / divisor)}g`} />
        <SummaryCard
          label="Daily salt / person"
          value={`${formatNumber(sodiumToSaltG(includedTotals.sodiumMg)! / divisor, 1)}g`}
        />
        <SummaryCard label="Daily potassium / person" value={formatMg(includedTotals.potassiumMg / divisor)} />
      </div>

      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-3 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="block text-xs text-zinc-500 mb-1">People</span>
          <input
            type="number"
            min={1}
            value={people}
            onChange={(e) => setPeople(Math.max(Number(e.target.value) || 1, 1))}
            className="w-20 rounded-md border border-zinc-200 dark:border-zinc-800 bg-transparent px-2 py-1"
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-zinc-500 mb-1">Days</span>
          <input
            type="number"
            min={1}
            value={days}
            onChange={(e) => setDays(Math.max(Number(e.target.value) || 1, 1))}
            className="w-20 rounded-md border border-zinc-200 dark:border-zinc-800 bg-transparent px-2 py-1"
          />
        </label>
        <div className="text-xs text-zinc-500">
          Main summary excludes disposed items and divides by {people} people over {days} days.
        </div>
      </div>

      <div className="grid xl:grid-cols-[minmax(0,1fr)_320px] gap-4 items-start">
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-auto max-h-[72vh]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-zinc-50 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 text-left">
              <tr>
                <th className="px-4 py-3 font-medium w-10">
                  <input
                    type="checkbox"
                    aria-label="Select all items"
                    checked={selectedIds.size === items.length && items.length > 0}
                    onChange={(e) => (e.target.checked ? selectAllVisible() : clearSelection())}
                  />
                </th>
                <th className="px-4 py-3 font-medium">Item</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Amount</th>
                <th className="px-4 py-3 font-medium text-right">Price</th>
                <th className="px-4 py-3 font-medium text-right">Calories</th>
                <th className="px-4 py-3 font-medium">Macros</th>
                <th className="px-4 py-3 font-medium">Sugar & fiber</th>
                <th className="px-4 py-3 font-medium">Electrolytes</th>
                <th className="px-4 py-3 font-medium">Source</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const values = rowValues(item);
                const selected = selectedIds.has(item.id);
                const serving = values.meta?.serving;

                return (
                  <tr
                    key={item.id}
                    className={`border-t border-zinc-100 dark:border-zinc-800 ${statusClass[item.consumptionStatus]} ${
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
                    <td className="px-4 py-3 font-medium align-top">
                      <div className="flex items-start gap-3 min-w-72">
                        {item.productImageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={item.productImageUrl}
                            alt=""
                            className="h-14 w-14 rounded-md border border-zinc-200 dark:border-zinc-800 object-cover bg-zinc-50 dark:bg-zinc-950"
                            loading="lazy"
                          />
                        ) : (
                          <div className="h-14 w-14 rounded-md border border-dashed border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950" />
                        )}
                        <div>
                          <div>{item.rawName}</div>
                          {item.normalizedName && (
                            <div className="text-xs text-zinc-500 mt-1">{item.normalizedName}</div>
                          )}
                          <div className="text-xs text-zinc-500 mt-1">
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
                        onChange={(e) => setStatus([item.id], e.target.value as ConsumptionStatus)}
                        className="rounded-md border border-zinc-200 dark:border-zinc-800 bg-transparent px-2 py-1 text-xs"
                      >
                        <option value="available">available</option>
                        <option value="consumed">consumed</option>
                        <option value="disposed">disposed</option>
                      </select>
                    </td>
                    <td className="px-4 py-3 text-xs text-zinc-600 dark:text-zinc-400 align-top">
                      <div>{formatNormalizedAmount(item.rawName, item.unit, item.nutrition?.totalGrams)}</div>
                      <div className="text-zinc-500 mt-1">
                        {formatNumber(item.quantity, 2)} {item.unit}
                      </div>
                      {serving?.estimatedServings ? (
                        <div className="text-zinc-500 mt-1">
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
                    </td>
                    <td className="px-4 py-3 text-xs text-zinc-600 dark:text-zinc-400 align-top">
                      P {formatNumber(values.proteinG, 1)}g · C {formatNumber(values.carbsG, 1)}g · F{" "}
                      {formatNumber(values.fatG, 1)}g
                      {item.nutrition?.totalGrams ? (
                        <div className="text-zinc-500 mt-1">{formatNumber(item.nutrition.totalGrams)}g estimated</div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-xs text-zinc-600 dark:text-zinc-400 align-top">
                      Sugar {formatNumber(values.sugarG, 1)}g
                      <div className="text-zinc-500 mt-1">Fiber {formatNumber(values.fiberG, 1)}g</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-zinc-600 dark:text-zinc-400 align-top">
                      Na {formatMg(values.sodiumMg)}
                      <div className="text-zinc-500 mt-1">
                        Salt {formatNumber(sodiumToSaltG(values.sodiumMg), 2)}g · K {formatMg(values.potassiumMg)}
                      </div>
                      <div className="text-zinc-500 mt-1">
                        Mg {formatMg(values.magnesiumMg)} · Ca {formatMg(values.calciumMg)}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs align-top">
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
                      {values.meta?.dataType && <div className="text-zinc-500 mt-1">{values.meta.dataType}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="sticky bottom-0 z-10 bg-zinc-50 dark:bg-zinc-800 text-sm shadow-[0_-1px_0_rgba(0,0,0,0.08)]">
              <tr>
                <td className="px-4 py-3"></td>
                <td className="px-4 py-3 font-medium">All items total</td>
                <td className="px-4 py-3 text-xs">{allTotals.itemCount} items</td>
                <td className="px-4 py-3 text-xs">{allTotals.knownItems} nutrition totals</td>
                <td className="px-4 py-3 text-right font-medium">{formatMoney(allTotals.price)}</td>
                <td className="px-4 py-3 text-right font-medium">{formatNumber(allTotals.calories)}</td>
                <td className="px-4 py-3 text-xs">
                  P {formatNumber(allTotals.proteinG)}g · C {formatNumber(allTotals.carbsG)}g · F{" "}
                  {formatNumber(allTotals.fatG)}g
                </td>
                <td className="px-4 py-3 text-xs">
                  Sugar {formatNumber(allTotals.sugarG)}g · Fiber {formatNumber(allTotals.fiberG)}g
                </td>
                <td className="px-4 py-3 text-xs">
                  Salt {formatNumber(sodiumToSaltG(allTotals.sodiumMg), 1)}g · K {formatMg(allTotals.potassiumMg)}
                </td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>

        <aside className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4 xl:sticky xl:top-4 space-y-4">
          <div>
            <div className="text-sm font-semibold">Selected items</div>
            <div className="text-xs text-zinc-500 mt-1">
              {selectedTotals.itemCount} selected · {selectedTotals.knownItems} with nutrition totals
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <SummaryCard label="Calories" value={formatNumber(selectedTotals.calories)} />
            <SummaryCard label="Price" value={formatMoney(selectedTotals.price)} />
            <SummaryCard label="Protein" value={`${formatNumber(selectedTotals.proteinG)}g`} />
            <SummaryCard label="Carbs" value={`${formatNumber(selectedTotals.carbsG)}g`} />
            <SummaryCard label="Fat" value={`${formatNumber(selectedTotals.fatG)}g`} />
            <SummaryCard label="Sugar" value={`${formatNumber(selectedTotals.sugarG)}g`} />
            <SummaryCard label="Salt" value={`${formatNumber(sodiumToSaltG(selectedTotals.sodiumMg), 1)}g`} />
            <SummaryCard label="Potassium" value={formatMg(selectedTotals.potassiumMg)} />
          </div>
          <div className="flex flex-wrap gap-2">
            {(["available", "consumed", "disposed"] as ConsumptionStatus[]).map((status) => (
              <button
                key={status}
                type="button"
                disabled={selectedIds.size === 0 || saving}
                onClick={() => setStatus(Array.from(selectedIds), status)}
                className="px-3 py-2 rounded-md border border-zinc-200 dark:border-zinc-800 text-xs font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50"
              >
                Mark {status}
              </button>
            ))}
            <button
              type="button"
              onClick={clearSelection}
              className="px-3 py-2 rounded-md text-xs text-zinc-500 hover:underline"
            >
              Clear
            </button>
          </div>
          <div className="text-xs text-zinc-500">
            Selection totals include selected disposed/refunded rows if you select them. Main summary only excludes
            disposed rows.
          </div>
        </aside>
      </div>
    </div>
  );
}
