"use client";

import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight, Coffee, Search, ShoppingBag, Utensils, Wine } from "lucide-react";
import { useMemo, useState } from "react";
import { receiptDedupeSignature } from "@/lib/receipts/signature";
import { todayIsoInTimeZone } from "@/lib/timezone";

type DateMode = "bought" | "estimated";
type EstimateCategory = "food" | "controlled" | "alcohol" | "caffeine";
type CategoryFilters = Record<EstimateCategory, boolean>;

export type CalendarReceipt = {
  id: number;
  vendor: string | null;
  purchasedAt: string | null;
  total: number | null;
  source: string;
  createdAt: string | null;
  itemCount: number;
};

export type CalendarItem = {
  id: number;
  receiptId: number;
  rawName: string;
  quantity: number;
  unit: string;
  price: number | null;
  consumptionStatus: string;
  statusDate: string | null;
  receiptVendor: string | null;
  receiptPurchasedAt: string | null;
  receiptCreatedAt: string | null;
  totalGrams: number | null;
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  alcoholG: number | null;
  caffeineMg: number | null;
  activeIngredientsJson: string | null;
};

type NutritionMeta = {
  basis?: string;
  entryType?: string;
  packageGrams?: number | null;
  active?: {
    alcoholG?: number | null;
    caffeineMg?: number | null;
    thcMg?: number | null;
    cbdMg?: number | null;
    cbnMg?: number | null;
    cbgMg?: number | null;
    totalThcMg?: number | null;
    totalCbdMg?: number | null;
    terpeneMg?: number | null;
  };
  per100g?: {
    calories?: number | null;
    proteinG?: number | null;
    carbsG?: number | null;
    fatG?: number | null;
    alcoholG?: number | null;
    caffeineMg?: number | null;
  };
};

type EstimateTotals = {
  price: number;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  activeGrams: number;
  alcoholG: number;
  caffeineMg: number;
  thcMg: number;
  cbdMg: number;
  cbnMg: number;
  cbgMg: number;
  terpeneMg: number;
  itemCount: number;
  knownItems: number;
};

type EstimateInterval = {
  id: string;
  vendorKey: string;
  vendorLabel: string;
  startDate: string;
  endDate: string;
  days: number;
  projected: boolean;
  receipt: CalendarReceipt;
  items: CalendarItem[];
  totals: EstimateTotals;
  daily: EstimateTotals;
};

type CalendarEvent =
  | {
      id: string;
      date: string;
      kind: "receipt";
      receipt: CalendarReceipt;
      duplicateCount: number;
    }
  | {
      id: string;
      date: string;
      kind: "estimate";
      interval: EstimateInterval;
      totals: EstimateTotals;
    };

type ItemRow = {
  id: string;
  date: string | null;
  item: CalendarItem;
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const GRAMS_PER_OUNCE = 28.349523125;
const CATEGORY_FILTERS: Array<{ id: EstimateCategory; label: string }> = [
  { id: "food", label: "Food" },
  { id: "controlled", label: "Controlled" },
  { id: "alcohol", label: "Alcohol" },
  { id: "caffeine", label: "Caffeine" },
];
const DEFAULT_CATEGORY_FILTERS: CategoryFilters = {
  food: true,
  controlled: true,
  alcohol: true,
  caffeine: true,
};
const ACTIVE_ITEM_SIGNAL_RE =
  /\b(dutch\s*love|thc|cbd|cbn|cbg|pre[-\s]?roll|preroll|flower|indica|sativa|hybrid|rosin|hash|vape|cart|edible|gumm(?:y|ies)|joint)\b/i;
const ALCOHOL_ITEM_SIGNAL_RE = /\b(beer|wine|cider|vodka|gin|rum|whisk(?:y|ey)|tequila|liqueur|cocktail|cooler|seltzer)\b/i;
const CAFFEINE_ITEM_SIGNAL_RE = /\b(coffee|espresso|latte|tea|matcha|yerba|energy\s*drink|caffeine)\b/i;

function datePart(value: string | null | undefined) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function monthStartIso(value: string) {
  return `${value.slice(0, 7)}-01`;
}

function addMonths(value: string, amount: number) {
  const date = new Date(`${monthStartIso(value)}T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + amount);
  return date.toISOString().slice(0, 10);
}

function addDays(value: string, amount: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function daysBetween(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00.000Z`).getTime();
  const end = new Date(`${endDate}T00:00:00.000Z`).getTime();
  return Math.round((end - start) / 86_400_000);
}

function calendarDays(cursor: string) {
  const start = new Date(`${monthStartIso(cursor)}T00:00:00.000Z`);
  const gridStart = addDays(start.toISOString().slice(0, 10), -start.getUTCDay());
  return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
}

function monthTitle(value: string) {
  return new Date(`${monthStartIso(value)}T00:00:00.000Z`).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatDate(value: string | null) {
  if (!value) return "No date";
  return new Date(`${value}T00:00:00.000Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatShortDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function formatMoney(value: number | null) {
  if (value == null) return "";
  return `$${value.toFixed(2)}`;
}

function formatQty(quantity: number, unit: string) {
  const amount = Number.isInteger(quantity) ? String(quantity) : quantity.toFixed(2);
  return `${amount} ${unit}`;
}

function formatNumber(value: number, digits = 0) {
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function formatMetric(value: number) {
  return value >= 100 ? value.toFixed(0) : value.toFixed(1).replace(/\.0$/, "");
}

function formatActiveGrams(value: number) {
  if (value >= 10) return `${formatNumber(value, 1)}g`;
  return `${formatNumber(value, 2)}g`;
}

function formatMg(value: number) {
  return value >= 100 ? `${formatNumber(value)}mg` : `${formatNumber(value, 1)}mg`;
}

function formatAlcoholOz(alcoholG: number) {
  return `${formatNumber(alcoholG / GRAMS_PER_OUNCE, 2)}oz`;
}

function eventDateForReceipt(receipt: CalendarReceipt) {
  return datePart(receipt.purchasedAt);
}

function boughtDateForItem(item: CalendarItem) {
  return datePart(item.receiptPurchasedAt);
}

function emptyTotals(): EstimateTotals {
  return {
    price: 0,
    calories: 0,
    proteinG: 0,
    carbsG: 0,
    fatG: 0,
    activeGrams: 0,
    alcoholG: 0,
    caffeineMg: 0,
    thcMg: 0,
    cbdMg: 0,
    cbnMg: 0,
    cbgMg: 0,
    terpeneMg: 0,
    itemCount: 0,
    knownItems: 0,
  };
}

function addTotals(target: EstimateTotals, source: EstimateTotals) {
  target.price += source.price;
  target.calories += source.calories;
  target.proteinG += source.proteinG;
  target.carbsG += source.carbsG;
  target.fatG += source.fatG;
  target.activeGrams += source.activeGrams;
  target.alcoholG += source.alcoholG;
  target.caffeineMg += source.caffeineMg;
  target.thcMg += source.thcMg;
  target.cbdMg += source.cbdMg;
  target.cbnMg += source.cbnMg;
  target.cbgMg += source.cbgMg;
  target.terpeneMg += source.terpeneMg;
  target.itemCount += source.itemCount;
  target.knownItems += source.knownItems;
}

function scaledTotals(totals: EstimateTotals, divisor: number) {
  if (divisor <= 0) return emptyTotals();
  return {
    price: totals.price / divisor,
    calories: totals.calories / divisor,
    proteinG: totals.proteinG / divisor,
    carbsG: totals.carbsG / divisor,
    fatG: totals.fatG / divisor,
    activeGrams: totals.activeGrams / divisor,
    alcoholG: totals.alcoholG / divisor,
    caffeineMg: totals.caffeineMg / divisor,
    thcMg: totals.thcMg / divisor,
    cbdMg: totals.cbdMg / divisor,
    cbnMg: totals.cbnMg / divisor,
    cbgMg: totals.cbgMg / divisor,
    terpeneMg: totals.terpeneMg / divisor,
    itemCount: totals.itemCount,
    knownItems: totals.knownItems,
  };
}

function eventsTotals(events: CalendarEvent[]) {
  return events.reduce((totals, event) => {
    if (event.kind === "estimate") addTotals(totals, event.totals);
    return totals;
  }, emptyTotals());
}

function parseMeta(value: string | null | undefined): NutritionMeta {
  if (!value) return {};
  try {
    return JSON.parse(value) as NutritionMeta;
  } catch {
    return {};
  }
}

function finite(value: number | null | undefined) {
  return value != null && Number.isFinite(value) ? value : 0;
}

function itemValues(item: CalendarItem) {
  const meta = parseMeta(item.activeIngredientsJson);
  const per100gOnly = meta.basis === "per_100g_reference_only";
  const active = meta.active;
  return {
    meta,
    calories: per100gOnly ? meta.per100g?.calories : item.calories,
    proteinG: per100gOnly ? meta.per100g?.proteinG : item.proteinG,
    carbsG: per100gOnly ? meta.per100g?.carbsG : item.carbsG,
    fatG: per100gOnly ? meta.per100g?.fatG : item.fatG,
    alcoholG: per100gOnly ? meta.per100g?.alcoholG : (item.alcoholG ?? active?.alcoholG),
    caffeineMg: per100gOnly ? meta.per100g?.caffeineMg : (item.caffeineMg ?? active?.caffeineMg),
    thcMg: active?.thcMg ?? active?.totalThcMg,
    cbdMg: active?.cbdMg ?? active?.totalCbdMg,
    cbnMg: active?.cbnMg,
    cbgMg: active?.cbgMg,
    terpeneMg: active?.terpeneMg,
  };
}

function hasActiveCompounds(values: ReturnType<typeof itemValues>) {
  return [values.thcMg, values.cbdMg, values.cbnMg, values.cbgMg, values.terpeneMg].some(
    (value) => finite(value) > 0,
  );
}

function packageGramsFromName(name: string) {
  const multi = name.match(/\b(\d+(?:\.\d+)?)\s*[xX]\s*(\d+(?:\.\d+)?)\s*g(?:rams?)?\b/i);
  if (multi) return Number(multi[1]) * Number(multi[2]);

  const grams = name.match(/\((\d+(?:\.\d+)?)\s*g(?:rams?)?\)/i) ?? name.match(/\b(\d+(?:\.\d+)?)\s*g(?:rams?)?\b/i);
  return grams ? Number(grams[1]) : null;
}

function activePackageGrams(item: CalendarItem, meta: NutritionMeta) {
  if (item.totalGrams != null && item.totalGrams > 0) return item.totalGrams;
  if (meta.packageGrams != null && meta.packageGrams > 0) return meta.packageGrams;
  if (item.unit.toLowerCase() === "g" && item.quantity > 1) return item.quantity;
  return packageGramsFromName(item.rawName);
}

function addItemEstimate(target: EstimateTotals, item: CalendarItem) {
  const values = itemValues(item);
  const activeItem =
    values.meta.entryType === "cannabis" ||
    hasActiveCompounds(values) ||
    ACTIVE_ITEM_SIGNAL_RE.test(`${item.receiptVendor ?? ""} ${item.rawName}`);

  target.itemCount += 1;
  if (item.totalGrams || values.meta.basis === "manual_entry") target.knownItems += 1;
  target.calories += finite(values.calories);
  target.proteinG += finite(values.proteinG);
  target.carbsG += finite(values.carbsG);
  target.fatG += finite(values.fatG);
  target.alcoholG += finite(values.alcoholG);
  target.caffeineMg += finite(values.caffeineMg);
  target.thcMg += finite(values.thcMg);
  target.cbdMg += finite(values.cbdMg);
  target.cbnMg += finite(values.cbnMg);
  target.cbgMg += finite(values.cbgMg);
  target.terpeneMg += finite(values.terpeneMg);

  if (activeItem) {
    target.activeGrams += finite(activePackageGrams(item, values.meta));
  }
}

function receiptEstimateTotals(receipt: CalendarReceipt, items: CalendarItem[]) {
  const totals = emptyTotals();
  totals.price = receipt.total ?? items.reduce((sum, item) => sum + (item.price ?? 0), 0);
  for (const item of items) addItemEstimate(totals, item);
  return totals;
}

function hasEstimateValue(totals: EstimateTotals) {
  return (
    totals.price > 0 ||
    totals.calories > 0 ||
    totals.activeGrams > 0 ||
    totals.alcoholG > 0 ||
    totals.thcMg > 0 ||
    totals.cbdMg > 0
  );
}

function titleCase(value: string) {
  return value.replace(/\b[a-z]/g, (char) => char.toUpperCase());
}

function vendorBucket(vendor: string | null) {
  const raw = vendor?.trim() || "Unknown";
  const lower = raw.toLowerCase();
  if (/\b(?:t&t|tnt|tntsupermarket)\b/i.test(raw)) return { key: "tnt", label: "T&T Supermarket" };
  if (/costco/i.test(raw)) return { key: "costco", label: "Costco" };
  if (/price\s*smart|pricesmart/i.test(raw)) return { key: "pricesmart", label: "PriceSmart Foods" };
  if (/uber\s*eats|\bubereats\b/i.test(raw)) return { key: "ubereats", label: "Uber Eats" };
  if (/dutch\s*love/i.test(raw)) return { key: "dutch-love", label: "Dutch Love" };

  const cleaned = lower
    .replace(/\s+-\s*order\s*#?\s*[a-z0-9-]+/g, "")
    .replace(/\border\s*#?\s*[a-z0-9-]+/g, "")
    .replace(/#[a-z0-9-]+/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  return {
    key: cleaned || "unknown",
    label: cleaned ? titleCase(cleaned) : raw,
  };
}

function median(values: number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[middle - 1] + sorted[middle]) / 2) : sorted[middle];
}

function clampedIntervalDays(days: number | null) {
  if (!days || days <= 0) return null;
  return Math.min(Math.max(Math.round(days), 1), 365);
}

function buildEstimateIntervals(
  receipts: CalendarReceipt[],
  itemsByReceiptId: Map<number, CalendarItem[]>,
  primaryReceiptIds: Set<number>,
) {
  const grouped = new Map<
    string,
    Array<{ receipt: CalendarReceipt; date: string; vendorKey: string; vendorLabel: string; totals: EstimateTotals }>
  >();

  for (const receipt of receipts) {
    if (!primaryReceiptIds.has(receipt.id)) continue;
    const date = eventDateForReceipt(receipt);
    if (!date) continue;
    const bucket = vendorBucket(receipt.vendor);
    const items = itemsByReceiptId.get(receipt.id) ?? [];
    const totals = receiptEstimateTotals(receipt, items);
    if (!hasEstimateValue(totals)) continue;

    const list = grouped.get(bucket.key) ?? [];
    list.push({
      receipt,
      date,
      vendorKey: bucket.key,
      vendorLabel: bucket.label,
      totals,
    });
    grouped.set(bucket.key, list);
  }

  const intervals: EstimateInterval[] = [];

  for (const group of grouped.values()) {
    const sorted = [...group].sort((a, b) => a.date.localeCompare(b.date) || a.receipt.id - b.receipt.id);
    if (sorted.length < 2) continue;

    const repeatDays = sorted
      .slice(0, -1)
      .map((entry, index) => daysBetween(entry.date, sorted[index + 1].date))
      .filter((days) => days > 0);
    const medianDays = clampedIntervalDays(median(repeatDays));

    for (const [index, entry] of sorted.entries()) {
      const next = sorted[index + 1];
      const days = clampedIntervalDays(next ? daysBetween(entry.date, next.date) : medianDays);
      if (!days) continue;

      const daily = scaledTotals(entry.totals, days);
      intervals.push({
        id: `${entry.vendorKey}-${entry.receipt.id}-${entry.date}`,
        vendorKey: entry.vendorKey,
        vendorLabel: entry.vendorLabel,
        startDate: entry.date,
        endDate: addDays(entry.date, days - 1),
        days,
        projected: !next,
        receipt: entry.receipt,
        items: itemsByReceiptId.get(entry.receipt.id) ?? [],
        totals: entry.totals,
        daily,
      });
    }
  }

  return intervals;
}

function intervalMatchesSearch(interval: EstimateInterval, search: string) {
  if (!search) return true;
  const haystack = [
    interval.vendorLabel,
    interval.receipt.vendor,
    interval.receipt.total,
    ...interval.items.map((item) => item.rawName),
  ].join(" ");
  return haystack.toLowerCase().includes(search);
}

function eventMatchesSearch(event: CalendarEvent, search: string) {
  if (!search) return true;
  if (event.kind === "receipt") {
    const haystack = `${event.receipt.vendor ?? ""} ${event.receipt.total ?? ""}`;
    return haystack.toLowerCase().includes(search);
  }
  return intervalMatchesSearch(event.interval, search);
}

function modeClasses(active: boolean) {
  return active
    ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
    : "border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800";
}

function dailyBrief(totals: EstimateTotals) {
  const metrics = [
    totals.price > 0 ? `${formatMoney(totals.price)}/d` : null,
    totals.calories > 0 ? `${formatMetric(totals.calories)} cal` : null,
    totals.activeGrams > 0 ? `Active ${formatActiveGrams(totals.activeGrams)}` : null,
    totals.alcoholG > 0 ? `Alc ${formatAlcoholOz(totals.alcoholG)}` : null,
    totals.caffeineMg > 0 ? `Caff ${formatMg(totals.caffeineMg)}` : null,
  ].filter(Boolean);
  return metrics.slice(0, 3).join(" · ");
}

function activeLine(totals: EstimateTotals) {
  const metrics = [
    totals.thcMg > 0 ? `THC ${formatMg(totals.thcMg)}` : null,
    totals.cbdMg > 0 ? `CBD ${formatMg(totals.cbdMg)}` : null,
    totals.cbnMg > 0 ? `CBN ${formatMg(totals.cbnMg)}` : null,
    totals.cbgMg > 0 ? `CBG ${formatMg(totals.cbgMg)}` : null,
    totals.terpeneMg > 0 ? `Terp ${formatMg(totals.terpeneMg)}` : null,
  ].filter(Boolean);
  return metrics.slice(0, 3).join(" · ");
}

function macroLine(totals: EstimateTotals) {
  return [
    totals.proteinG > 0 ? `P ${formatMetric(totals.proteinG)}g` : null,
    totals.carbsG > 0 ? `C ${formatMetric(totals.carbsG)}g` : null,
    totals.fatG > 0 ? `F ${formatMetric(totals.fatG)}g` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function categoryIcon(category: EstimateCategory) {
  if (category === "controlled") return <span aria-hidden="true">🥬</span>;
  if (category === "alcohol") return <Wine className="size-4" />;
  if (category === "caffeine") return <Coffee className="size-4" />;
  return <Utensils className="size-4" />;
}

function estimateCategory(interval: EstimateInterval): EstimateCategory {
  const itemText = interval.items.map((item) => item.rawName).join(" ");
  const haystack = `${interval.vendorLabel} ${interval.receipt.vendor ?? ""} ${itemText}`;
  if (
    interval.vendorKey === "dutch-love" ||
    interval.daily.activeGrams > 0 ||
    interval.daily.thcMg > 0 ||
    interval.daily.cbdMg > 0 ||
    interval.daily.cbnMg > 0 ||
    interval.daily.cbgMg > 0 ||
    ACTIVE_ITEM_SIGNAL_RE.test(haystack)
  ) {
    return "controlled";
  }
  if (interval.daily.alcoholG > 0 || ALCOHOL_ITEM_SIGNAL_RE.test(haystack)) return "alcohol";
  if (interval.daily.caffeineMg > 0 || CAFFEINE_ITEM_SIGNAL_RE.test(haystack)) return "caffeine";
  return "food";
}

function summaryCardClasses(count: number) {
  if (count <= 1) return "grid gap-3";
  if (count === 2) return "grid gap-3 sm:grid-cols-2";
  if (count === 3) return "grid gap-3 sm:grid-cols-3";
  return "grid gap-3 sm:grid-cols-2 lg:grid-cols-4";
}

export function ReceiptCalendarView({
  receipts,
  items,
  timeZone,
}: {
  receipts: CalendarReceipt[];
  items: CalendarItem[];
  timeZone: string;
}) {
  const [mode, setMode] = useState<DateMode>("bought");
  const today = todayIsoInTimeZone(timeZone);
  const latestBoughtDate = receipts
    .map((receipt) => datePart(receipt.purchasedAt))
    .filter((date): date is string => Boolean(date))
    .sort()
    .at(-1);
  const [cursor, setCursor] = useState(monthStartIso(latestBoughtDate ?? today));
  const [search, setSearch] = useState("");
  const [categoryFilters, setCategoryFilters] = useState<CategoryFilters>(DEFAULT_CATEGORY_FILTERS);
  const [hiddenVendorKeys, setHiddenVendorKeys] = useState<Set<string>>(new Set());
  const query = search.trim().toLowerCase();

  const itemsByReceiptId = useMemo(() => {
    const map = new Map<number, CalendarItem[]>();
    for (const item of items) {
      const receiptItems = map.get(item.receiptId) ?? [];
      receiptItems.push(item);
      map.set(item.receiptId, receiptItems);
    }
    return map;
  }, [items]);

  const boughtDedupe = useMemo(() => {
    const bySignature = new Map<
      string,
      { event: Extract<CalendarEvent, { kind: "receipt" }>; receiptIds: number[] }
    >();
    const undated: CalendarReceipt[] = [];

    for (const receipt of receipts) {
      const date = eventDateForReceipt(receipt);
      if (!date) {
        undated.push(receipt);
        continue;
      }

      const key =
        receiptDedupeSignature(receipt, itemsByReceiptId.get(receipt.id) ?? []) ??
        `receipt:${receipt.id}`;
      const existing = bySignature.get(key);
      if (existing) {
        existing.receiptIds.push(receipt.id);
        existing.event.duplicateCount += 1;
        continue;
      }

      bySignature.set(key, {
        event: {
          id: `receipt-${receipt.id}`,
          kind: "receipt",
          receipt,
          date,
          duplicateCount: 0,
        },
        receiptIds: [receipt.id],
      });
    }

    return {
      events: Array.from(bySignature.values()).map((entry) => entry.event),
      primaryReceiptIds: new Set(Array.from(bySignature.values()).map((entry) => entry.event.receipt.id)),
      undated,
    };
  }, [itemsByReceiptId, receipts]);

  const receiptEvents = boughtDedupe.events;
  const primaryBoughtReceiptIds = boughtDedupe.primaryReceiptIds;

  const estimateIntervals = useMemo(
    () => buildEstimateIntervals(receipts, itemsByReceiptId, primaryBoughtReceiptIds),
    [itemsByReceiptId, primaryBoughtReceiptIds, receipts],
  );

  const estimateVendorOptions = useMemo(() => {
    const vendors = new Map<string, { key: string; label: string; count: number }>();
    for (const interval of estimateIntervals) {
      const existing = vendors.get(interval.vendorKey);
      if (existing) existing.count += 1;
      else vendors.set(interval.vendorKey, { key: interval.vendorKey, label: interval.vendorLabel, count: 1 });
    }
    return Array.from(vendors.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [estimateIntervals]);

  const filteredEstimateIntervals = useMemo(
    () =>
      estimateIntervals.filter((interval) => {
        if (hiddenVendorKeys.has(interval.vendorKey)) return false;
        return categoryFilters[estimateCategory(interval)];
      }),
    [categoryFilters, estimateIntervals, hiddenVendorKeys],
  );

  const estimateEvents = useMemo<CalendarEvent[]>(() => {
    const events: CalendarEvent[] = [];
    for (const interval of filteredEstimateIntervals) {
      for (let index = 0; index < interval.days; index += 1) {
        const date = addDays(interval.startDate, index);
        events.push({
          id: `estimate-${interval.id}-${date}`,
          kind: "estimate",
          date,
          interval,
          totals: interval.daily,
        });
      }
    }
    return events;
  }, [filteredEstimateIntervals]);

  const activeEvents = useMemo(() => {
    const events = mode === "bought" ? receiptEvents : estimateEvents;
    return events.filter((event) => eventMatchesSearch(event, query));
  }, [estimateEvents, mode, query, receiptEvents]);

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const event of activeEvents) {
      const list = map.get(event.date) ?? [];
      list.push(event);
      map.set(event.date, list);
    }
    return map;
  }, [activeEvents]);

  const itemRows = useMemo<ItemRow[]>(() => {
    const rows: ItemRow[] = [];
    for (const item of items) {
      if (!primaryBoughtReceiptIds.has(item.receiptId)) continue;
      rows.push({ id: `item-${item.id}`, date: boughtDateForItem(item), item });
    }

    return rows
      .filter((row) => {
        if (!query) return true;
        return `${row.item.rawName} ${row.item.receiptVendor ?? ""}`.toLowerCase().includes(query);
      })
      .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || a.item.rawName.localeCompare(b.item.rawName));
  }, [items, primaryBoughtReceiptIds, query]);

  const intervalRows = useMemo(
    () =>
      filteredEstimateIntervals
        .filter((interval) => intervalMatchesSearch(interval, query))
        .sort((a, b) => b.startDate.localeCompare(a.startDate) || a.vendorLabel.localeCompare(b.vendorLabel)),
    [filteredEstimateIntervals, query],
  );

  const days = calendarDays(cursor);
  const selectedMonth = cursor.slice(0, 7);
  const monthEvents = activeEvents.filter((event) => event.date.slice(0, 7) === selectedMonth);
  const receiptSpend =
    mode === "bought"
      ? monthEvents.reduce((sum, event) => sum + (event.kind === "receipt" ? event.receipt.total ?? 0 : 0), 0)
      : 0;
  const estimateMonthTotals = mode === "estimated" ? eventsTotals(monthEvents) : emptyTotals();
  const estimateDays = mode === "estimated" ? new Set(monthEvents.map((event) => event.date)).size : 0;
  const estimateDailyAverage = scaledTotals(estimateMonthTotals, estimateDays || 1);
  const currentProjectedInterval = intervalRows
    .filter((interval) => interval.projected)
    .sort((a, b) => b.endDate.localeCompare(a.endDate))[0];
  const projectedDaysRemaining = currentProjectedInterval
    ? Math.max(daysBetween(today, currentProjectedInterval.endDate) + 1, 0)
    : 0;
  const undatedReceipts = boughtDedupe.undated.filter((receipt) =>
    eventMatchesSearch({ id: `undated-${receipt.id}`, kind: "receipt", receipt, duplicateCount: 0, date: "" }, query),
  );
  const estimateSummaryCards = [
    {
      key: "month",
      label: "Month",
      value: monthTitle(cursor),
      sub: null,
    },
    mode === "bought" && monthEvents.length > 0
      ? {
          key: "receipts",
          label: "Receipts",
          value: String(monthEvents.length),
          sub: null,
        }
      : null,
    mode === "bought" && receiptSpend > 0
      ? {
          key: "spend",
          label: "Spend",
          value: formatMoney(receiptSpend),
          sub: null,
        }
      : null,
    mode === "estimated" && estimateDays > 0
      ? {
          key: "days",
          label: "Estimate days",
          value: String(estimateDays),
          sub: `${filteredEstimateIntervals.length} intervals`,
        }
      : null,
    mode === "estimated" && estimateDailyAverage.price > 0
      ? {
          key: "daily-spend",
          label: "Daily spend",
          value: `${formatMoney(estimateDailyAverage.price)}/day`,
          sub: null,
        }
      : null,
    mode === "estimated" && estimateDailyAverage.calories > 0
      ? {
          key: "daily-calories",
          label: "Calories/day",
          value: `${formatMetric(estimateDailyAverage.calories)} cal`,
          sub: macroLine(estimateDailyAverage) || null,
        }
      : null,
    mode === "estimated" && estimateDailyAverage.activeGrams > 0
      ? {
          key: "daily-active",
          label: "Controlled/day",
          value: formatActiveGrams(estimateDailyAverage.activeGrams),
          sub: activeLine(estimateDailyAverage) || null,
        }
      : null,
    mode === "estimated" && estimateDailyAverage.alcoholG > 0
      ? {
          key: "daily-alcohol",
          label: "Alcohol/day",
          value: formatAlcoholOz(estimateDailyAverage.alcoholG),
          sub: null,
        }
      : null,
    mode === "estimated" && estimateDailyAverage.caffeineMg > 0
      ? {
          key: "daily-caffeine",
          label: "Caffeine/day",
          value: formatMg(estimateDailyAverage.caffeineMg),
          sub: null,
        }
      : null,
    mode === "estimated" && currentProjectedInterval
      ? {
          key: "expected",
          label: "Expected use",
          value: projectedDaysRemaining > 0 ? `${projectedDaysRemaining} days left` : "Due now",
          sub: `${currentProjectedInterval.vendorLabel} through ${formatShortDate(currentProjectedInterval.endDate)}`,
        }
      : null,
  ].filter((card): card is { key: string; label: string; value: string; sub: string | null } => Boolean(card));

  function toggleCategory(category: EstimateCategory) {
    setCategoryFilters((current) => ({ ...current, [category]: !current[category] }));
  }

  function toggleVendor(vendorKey: string) {
    setHiddenVendorKeys((current) => {
      const next = new Set(current);
      if (next.has(vendorKey)) next.delete(vendorKey);
      else next.add(vendorKey);
      return next;
    });
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <Link href="/receipts" className="text-sm text-zinc-500 hover:underline">
            All receipts
          </Link>
          <h1 className="mt-2 text-2xl font-semibold">Receipt calendar</h1>
        </div>

        <div className="flex w-full flex-wrap items-center gap-2 md:w-auto">
          <div className="relative w-full sm:w-auto">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search"
              className="h-10 w-full rounded-md border border-zinc-200 bg-white pl-8 pr-3 text-sm outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 sm:w-48"
            />
          </div>
          <button
            type="button"
            onClick={() => setMode("bought")}
            className={`inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-md border px-3 text-sm font-medium sm:flex-none ${modeClasses(mode === "bought")}`}
          >
            <ShoppingBag className="size-4" />
            Bought
          </button>
          <button
            type="button"
            onClick={() => setMode("estimated")}
            className={`inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-md border px-3 text-sm font-medium sm:flex-none ${modeClasses(mode === "estimated")}`}
          >
            <Utensils className="size-4" />
            Estimated
          </button>
        </div>
      </div>

      <div className={summaryCardClasses(estimateSummaryCards.length)}>
        {estimateSummaryCards.map((card) => (
          <div key={card.key} className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="text-xs font-medium uppercase text-zinc-500">{card.label}</div>
            <div className="mt-2 text-xl font-semibold">{card.value}</div>
            {card.sub ? <div className="mt-1 text-xs text-zinc-500">{card.sub}</div> : null}
          </div>
        ))}
      </div>

      {mode === "estimated" ? (
        <div className="space-y-3 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium uppercase text-zinc-500">Include</span>
            {CATEGORY_FILTERS.map((category) => (
              <button
                key={category.id}
                type="button"
                onClick={() => toggleCategory(category.id)}
                className={`inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium ${
                  categoryFilters[category.id]
                    ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                    : "border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800"
                }`}
              >
                {categoryIcon(category.id)}
                {category.label}
              </button>
            ))}
          </div>
          {estimateVendorOptions.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium uppercase text-zinc-500">Vendors</span>
              {estimateVendorOptions.map((vendor) => {
                const enabled = !hiddenVendorKeys.has(vendor.key);
                return (
                  <button
                    key={vendor.key}
                    type="button"
                    onClick={() => toggleVendor(vendor.key)}
                    className={`h-9 rounded-md border px-3 text-sm font-medium ${
                      enabled
                        ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                        : "border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800"
                    }`}
                  >
                    {vendor.label} <span className="text-xs opacity-70">{vendor.count}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}

      <section className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-3 py-3 dark:border-zinc-800">
          <div className="inline-flex items-center gap-2 font-medium">
            <CalendarDays className="size-4" />
            {monthTitle(cursor)}
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setCursor(addMonths(cursor, -1))}
              className="inline-flex size-9 items-center justify-center rounded-md border border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800"
              aria-label="Previous month"
            >
              <ChevronLeft className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => setCursor(monthStartIso(today))}
              className="h-9 rounded-md border border-zinc-200 px-3 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => setCursor(addMonths(cursor, 1))}
              className="inline-flex size-9 items-center justify-center rounded-md border border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800"
              aria-label="Next month"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        </div>

        <div className="grid gap-2 p-3 md:hidden">
          {days
            .filter((day) => day.slice(0, 7) === selectedMonth)
            .map((day) => {
              const dayEvents = eventsByDate.get(day) ?? [];
              const isToday = day === today;
              const total = dayEvents.reduce(
                (sum, event) => sum + (event.kind === "receipt" ? event.receipt.total ?? 0 : 0),
                0,
              );
              const dayEstimateTotals = mode === "estimated" ? eventsTotals(dayEvents) : emptyTotals();
              const dayActiveLine = activeLine(dayEstimateTotals);
              if (!isToday && dayEvents.length === 0 && !hasEstimateValue(dayEstimateTotals)) return null;
              return (
                <div
                  key={day}
                  className={`rounded-md border p-3 ${
                    isToday
                      ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30"
                      : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">{formatDate(day)}</div>
                      {mode === "bought" && total > 0 ? (
                        <div className="mt-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">{formatMoney(total)}</div>
                      ) : null}
                      {mode === "estimated" && hasEstimateValue(dayEstimateTotals) ? (
                        <div className="mt-1 text-xs leading-5 text-emerald-700 dark:text-emerald-400">
                          {dayEstimateTotals.price > 0 ? <div className="font-medium">{formatMoney(dayEstimateTotals.price)}/day</div> : null}
                          {dayEstimateTotals.calories > 0 ? (
                            <div>
                              {formatMetric(dayEstimateTotals.calories)} cal · P {formatMetric(dayEstimateTotals.proteinG)}g
                            </div>
                          ) : null}
                          {dayEstimateTotals.activeGrams > 0 ? <div>Active {formatActiveGrams(dayEstimateTotals.activeGrams)}</div> : null}
                          {dayEstimateTotals.alcoholG > 0 ? <div>Alc {formatAlcoholOz(dayEstimateTotals.alcoholG)}</div> : null}
                          {dayEstimateTotals.caffeineMg > 0 ? <div>Caff {formatMg(dayEstimateTotals.caffeineMg)}</div> : null}
                          {dayActiveLine ? <div>{dayActiveLine}</div> : null}
                        </div>
                      ) : null}
                    </div>
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                      {isToday ? "Today" : dayEvents.length}
                    </span>
                  </div>
                  <div className="mt-3 space-y-1">
                    {dayEvents.slice(0, 5).map((event) =>
                      event.kind === "receipt" ? (
                        <Link
                          key={event.id}
                          href={`/receipts/${event.receipt.id}`}
                          className="block rounded border border-zinc-200 px-2 py-1.5 text-xs hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800"
                        >
                          <span className="font-medium">{event.receipt.vendor ?? "Unknown"}</span>{" "}
                          {formatMoney(event.receipt.total)}
                          {event.duplicateCount > 0 ? ` (${event.duplicateCount + 1} emails)` : ""}
                        </Link>
                      ) : (
                        <Link
                          key={event.id}
                          href={`/receipts/${event.interval.receipt.id}`}
                          className="block rounded border border-zinc-200 px-2 py-1.5 text-xs hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800"
                        >
                          <span className="font-medium">{event.interval.vendorLabel}</span> {dailyBrief(event.totals)}
                        </Link>
                      ),
                    )}
                    {dayEvents.length > 5 ? (
                      <div className="px-2 text-xs text-zinc-500">+{dayEvents.length - 5} more</div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          {monthEvents.length === 0 && !(today.slice(0, 7) === selectedMonth) ? (
            <div className="rounded-md border border-dashed border-zinc-200 px-3 py-8 text-center text-sm text-zinc-500 dark:border-zinc-800">
              No matching calendar entries this month.
            </div>
          ) : null}
        </div>

        <div className="hidden overflow-x-auto md:block">
          <div className="min-w-[880px] p-3">
            <div className="grid grid-cols-7 gap-2 pb-2 text-xs font-medium uppercase text-zinc-500">
              {WEEKDAYS.map((weekday) => (
                <div key={weekday} className="px-2">
                  {weekday}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-2">
              {days.map((day) => {
                const dayEvents = eventsByDate.get(day) ?? [];
                const outsideMonth = day.slice(0, 7) !== selectedMonth;
                const isToday = day === today;
                const total = dayEvents.reduce(
                  (sum, event) => sum + (event.kind === "receipt" ? event.receipt.total ?? 0 : 0),
                  0,
                );
                const dayEstimateTotals = mode === "estimated" ? eventsTotals(dayEvents) : emptyTotals();
                const dayActiveLine = activeLine(dayEstimateTotals);
                return (
                  <div
                    key={day}
                    className={`min-h-36 rounded-md border p-2 ${
                      outsideMonth
                        ? "border-zinc-100 bg-zinc-50 text-zinc-400 dark:border-zinc-900 dark:bg-zinc-950"
                        : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
                    } ${isToday ? "ring-2 ring-emerald-500 ring-offset-2 ring-offset-white dark:ring-offset-zinc-950" : ""}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-medium">{Number(day.slice(8, 10))}</span>
                      {dayEvents.length > 0 ? (
                        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                          {dayEvents.length}
                        </span>
                      ) : null}
                    </div>
                    {mode === "bought" && total > 0 ? (
                      <div className="mt-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">{formatMoney(total)}</div>
                    ) : null}
                    {mode === "estimated" && hasEstimateValue(dayEstimateTotals) ? (
                      <div className="mt-1 text-xs leading-5 text-emerald-700 dark:text-emerald-400">
                        {dayEstimateTotals.price > 0 ? <div className="font-medium">{formatMoney(dayEstimateTotals.price)}/day</div> : null}
                        {dayEstimateTotals.calories > 0 ? (
                          <div>
                            {formatMetric(dayEstimateTotals.calories)} cal · P {formatMetric(dayEstimateTotals.proteinG)}g
                          </div>
                        ) : null}
                        {dayEstimateTotals.activeGrams > 0 ? <div>Active {formatActiveGrams(dayEstimateTotals.activeGrams)}</div> : null}
                        {dayEstimateTotals.alcoholG > 0 ? <div>Alc {formatAlcoholOz(dayEstimateTotals.alcoholG)}</div> : null}
                        {dayEstimateTotals.caffeineMg > 0 ? <div>Caff {formatMg(dayEstimateTotals.caffeineMg)}</div> : null}
                        {dayActiveLine ? <div>{dayActiveLine}</div> : null}
                      </div>
                    ) : null}
                    <div className="mt-2 space-y-1">
                      {dayEvents.slice(0, 4).map((event) =>
                        event.kind === "receipt" ? (
                          <Link
                            key={event.id}
                            href={`/receipts/${event.receipt.id}`}
                            className="block truncate rounded border border-zinc-200 px-2 py-1 text-xs hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800"
                          >
                            {event.receipt.vendor ?? "Unknown"} {formatMoney(event.receipt.total)}
                            {event.duplicateCount > 0 ? ` (${event.duplicateCount + 1} emails)` : ""}
                          </Link>
                        ) : (
                          <Link
                            key={event.id}
                            href={`/receipts/${event.interval.receipt.id}`}
                            className="block truncate rounded border border-zinc-200 px-2 py-1 text-xs hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800"
                          >
                            {event.interval.vendorLabel} {dailyBrief(event.totals)}
                          </Link>
                        ),
                      )}
                      {dayEvents.length > 4 ? (
                        <div className="px-2 text-xs text-zinc-500">+{dayEvents.length - 4}</div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {mode === "bought" && undatedReceipts.length > 0 ? (
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm dark:border-amber-900 dark:bg-amber-950/30">
          <div className="font-semibold text-amber-900 dark:text-amber-200">
            Missing purchase date
          </div>
          <div className="mt-1 text-amber-800 dark:text-amber-300">
            {undatedReceipts.length} receipt{undatedReceipts.length === 1 ? "" : "s"} could not be placed on the calendar because no purchase date was visible.
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {undatedReceipts.slice(0, 8).map((receipt) => (
              <Link
                key={receipt.id}
                href={`/receipts/${receipt.id}`}
                className="rounded-md border border-amber-300 bg-white px-2 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200 dark:hover:bg-amber-900/40"
              >
                {receipt.vendor ?? "Unknown"} {formatMoney(receipt.total)}
              </Link>
            ))}
            {undatedReceipts.length > 8 ? (
              <span className="px-2 py-1 text-xs text-amber-800 dark:text-amber-300">
                +{undatedReceipts.length - 8} more
              </span>
            ) : null}
          </div>
        </section>
      ) : null}

      {mode === "bought" ? (
        <section className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <h2 className="font-semibold">Itemized</h2>
            <span className="text-sm text-zinc-500">{itemRows.length} rows</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[840px] text-sm">
              <thead className="bg-zinc-50 text-left text-zinc-600 dark:bg-zinc-800/50 dark:text-zinc-400">
                <tr>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Item</th>
                  <th className="px-4 py-3 font-medium">Receipt</th>
                  <th className="px-4 py-3 font-medium text-right">Quantity</th>
                  <th className="px-4 py-3 font-medium text-right">Price</th>
                </tr>
              </thead>
              <tbody>
                {itemRows.map((row) => (
                  <tr key={row.id} className="border-t border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/40">
                    <td className="whitespace-nowrap px-4 py-3 text-zinc-600 dark:text-zinc-400">{formatDate(row.date)}</td>
                    <td className="px-4 py-3">
                      <Link href={`/receipts/${row.item.receiptId}`} className="font-medium hover:underline">
                        {row.item.rawName}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{row.item.receiptVendor ?? "Unknown"}</td>
                    <td className="px-4 py-3 text-right">{formatQty(row.item.quantity, row.item.unit)}</td>
                    <td className="px-4 py-3 text-right">{formatMoney(row.item.price) || "-"}</td>
                  </tr>
                ))}
                {itemRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-sm text-zinc-500">
                      No rows
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <section className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <h2 className="font-semibold">Repeat intervals</h2>
            <span className="text-sm text-zinc-500">{intervalRows.length} rows</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[940px] text-sm">
              <thead className="bg-zinc-50 text-left text-zinc-600 dark:bg-zinc-800/50 dark:text-zinc-400">
                <tr>
                  <th className="px-4 py-3 font-medium">Start</th>
                  <th className="px-4 py-3 font-medium">Vendor</th>
                  <th className="px-4 py-3 font-medium">Receipt</th>
                  <th className="px-4 py-3 font-medium text-right">Days</th>
                  <th className="px-4 py-3 font-medium text-right">Daily estimate</th>
                </tr>
              </thead>
              <tbody>
                {intervalRows.map((interval) => {
                  const intervalActiveLine = activeLine(interval.daily);
                  const daysLeft = Math.max(daysBetween(today, interval.endDate) + 1, 0);
                  return (
                    <tr key={interval.id} className="border-t border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/40">
                      <td className="whitespace-nowrap px-4 py-3 text-zinc-600 dark:text-zinc-400">
                        {formatShortDate(interval.startDate)} - {formatShortDate(interval.endDate)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium">{interval.vendorLabel}</div>
                        {interval.projected ? (
                          <div className="mt-1 text-xs text-zinc-500">
                            {daysLeft > 0 ? `Expected ${daysLeft} days left` : "Expected to be due now"}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                        <Link href={`/receipts/${interval.receipt.id}`} className="hover:underline">
                          {interval.receipt.vendor ?? "Unknown"}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-right">{interval.days}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="font-medium">{dailyBrief(interval.daily) || "-"}</div>
                        {intervalActiveLine ? <div className="mt-1 text-xs text-zinc-500">{intervalActiveLine}</div> : null}
                      </td>
                    </tr>
                  );
                })}
                {intervalRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-sm text-zinc-500">
                      No repeat intervals
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
