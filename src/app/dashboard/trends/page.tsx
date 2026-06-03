import Link from "next/link";
import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { asc, desc, eq } from "drizzle-orm";
import {
  CalendarDays,
  Gauge,
  PackageCheck,
  Pill,
  ReceiptText,
  TrendingDown,
  TrendingUp,
  Utensils,
  Wine,
} from "lucide-react";
import { db, schema } from "@/db/client";
import { TIME_ZONE_COOKIE, timeZoneFromCookie, todayIsoInTimeZone } from "@/lib/timezone";
import {
  inferPurchasedDateFromText,
  normalizeReceiptDate,
} from "@/lib/receipts/dates";
import {
  receiptDedupeSignature,
  receiptHeaderSignature,
} from "@/lib/receipts/signature";

export const dynamic = "force-dynamic";

type RangeKey = "365" | "730" | "all";
type BucketMode = "month" | "year";
type CategoryKey =
  | "all"
  | "food"
  | "drink"
  | "controlled"
  | "supplement"
  | "household"
  | "personal_care"
  | "other";

type MetricTotals = {
  spend: number;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  cannabisG: number;
  otherControlledG: number;
  alcoholG: number;
  caffeineMg: number;
  thcMg: number;
  cbdMg: number;
  cbnMg: number;
  cbgMg: number;
  amphetamineMg: number;
  terpeneMg: number;
  itemCount: number;
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
    amphetamineMg?: number | null;
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

const RANGE_OPTIONS: Array<{ key: RangeKey; label: string }> = [
  { key: "365", label: "1y" },
  { key: "730", label: "2y" },
  { key: "all", label: "All" },
];

const BUCKET_OPTIONS: Array<{ key: BucketMode; label: string }> = [
  { key: "month", label: "Months" },
  { key: "year", label: "Years" },
];

const CATEGORY_OPTIONS: Array<{ key: CategoryKey; label: string }> = [
  { key: "all", label: "All categories" },
  { key: "food", label: "Food" },
  { key: "drink", label: "Drink" },
  { key: "controlled", label: "Controlled" },
  { key: "supplement", label: "Supplements" },
  { key: "household", label: "Household" },
  { key: "personal_care", label: "Personal care" },
  { key: "other", label: "Other" },
];

const ACTIVE_ITEM_SIGNAL_RE =
  /\b(dutch\s*love|thc|cbd|cbn|cbg|pre[-\s]?roll|preroll|flower|indica|sativa|hybrid|rosin|hash|vape|cart|edible|gumm(?:y|ies)|joint)\b/i;
const ALCOHOL_ITEM_SIGNAL_RE =
  /\b(beer|wine|cider|vodka|gin|rum|whisk(?:y|ey)|tequila|liqueur|cocktail|cooler|seltzer|lager|ale|ipa)\b/i;

const GRAMS_PER_OUNCE = 28.349523125;

function parseRange(value: string | string[] | undefined): RangeKey {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === "365" || raw === "730" || raw === "all" ? raw : "365";
}

function parseBucket(value: string | string[] | undefined): BucketMode {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === "year" ? "year" : "month";
}

function parseCategory(value: string | string[] | undefined): CategoryKey {
  const raw = Array.isArray(value) ? value[0] : value;
  return CATEGORY_OPTIONS.some((option) => option.key === raw) ? (raw as CategoryKey) : "all";
}

function trendsHref({
  range,
  bucket,
  category,
}: {
  range: RangeKey;
  bucket: BucketMode;
  category: CategoryKey;
}) {
  const params = new URLSearchParams({ range, bucket, category });
  return `/dashboard/trends?${params.toString()}`;
}

function addDays(value: string, amount: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function addMonths(value: string, amount: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + amount);
  return date.toISOString().slice(0, 10);
}

function daysBetween(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00.000Z`).getTime();
  const end = new Date(`${endDate}T00:00:00.000Z`).getTime();
  return Math.round((end - start) / 86_400_000);
}

function maxIso(a: string, b: string) {
  return a > b ? a : b;
}

function minIso(a: string, b: string) {
  return a < b ? a : b;
}

function rangeStart(range: RangeKey, today: string) {
  return range === "all" ? null : addDays(today, -Number(range) + 1);
}

function periodDays(start: string, end: string) {
  return Math.max(daysBetween(start, end) + 1, 1);
}

function inPeriod(date: string | null, start: string, end: string) {
  return Boolean(date && date >= start && date <= end);
}

function startOfBucket(value: string, bucket: BucketMode) {
  return bucket === "year" ? `${value.slice(0, 4)}-01-01` : `${value.slice(0, 7)}-01`;
}

function bucketKey(value: string, bucket: BucketMode) {
  return bucket === "year" ? value.slice(0, 4) : value.slice(0, 7);
}

function nextBucketStart(key: string, bucket: BucketMode) {
  return bucket === "year"
    ? `${Number(key) + 1}-01-01`
    : addMonths(`${key}-01`, 1);
}

function bucketRange(key: string, bucket: BucketMode) {
  const start = bucket === "year" ? `${key}-01-01` : `${key}-01`;
  return { start, end: addDays(nextBucketStart(key, bucket), -1) };
}

function buildBucketKeys(start: string, end: string, bucket: BucketMode) {
  const keys: string[] = [];
  let cursor = startOfBucket(start, bucket);
  while (cursor <= end) {
    keys.push(bucketKey(cursor, bucket));
    cursor = bucket === "year" ? `${Number(cursor.slice(0, 4)) + 1}-01-01` : addMonths(cursor, 1);
  }
  return keys;
}

function formatBucketLabel(key: string, bucket: BucketMode) {
  if (bucket === "year") return key;
  return new Date(`${key}-01T00:00:00.000Z`).toLocaleDateString(undefined, {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatShortDate(value: string | null) {
  if (!value) return "No date";
  return new Date(`${value}T00:00:00.000Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function formatMoney(value: number) {
  return `$${value.toLocaleString(undefined, {
    maximumFractionDigits: value >= 100 ? 0 : 2,
  })}`;
}

function formatDailyMoney(value: number) {
  return `${formatMoney(value)}/day`;
}

function formatSignedMoney(value: number) {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${formatMoney(Math.abs(value))}`;
}

function formatMetric(value: number, digits = 1) {
  if (value >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (value >= 100) return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return value.toFixed(digits).replace(/\.0$/, "");
}

function formatSignedMetric(value: number, suffix = "") {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${formatMetric(Math.abs(value))}${suffix}`;
}

function formatGrams(value: number) {
  if (value >= 10) return `${formatMetric(value, 1)}g`;
  return `${formatMetric(value, 2)}g`;
}

function formatDailyGrams(value: number) {
  return `${formatGrams(value)}/day`;
}

function formatMg(value: number) {
  if (value >= 100) return `${formatMetric(value, 0)}mg`;
  return `${formatMetric(value, 1)}mg`;
}

function formatAlcoholOz(value: number) {
  return `${formatMetric(value / GRAMS_PER_OUNCE, 2)}oz`;
}

function formatPercent(value: number) {
  if (!Number.isFinite(value)) return "0%";
  return `${Math.round(value * 100)}%`;
}

function formatPctPoint(value: number) {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${Math.abs(Math.round(value * 100))}pt`;
}

function finite(value: number | null | undefined) {
  return value != null && Number.isFinite(value) ? value : 0;
}

function emptyTotals(): MetricTotals {
  return {
    spend: 0,
    calories: 0,
    proteinG: 0,
    carbsG: 0,
    fatG: 0,
    cannabisG: 0,
    otherControlledG: 0,
    alcoholG: 0,
    caffeineMg: 0,
    thcMg: 0,
    cbdMg: 0,
    cbnMg: 0,
    cbgMg: 0,
    amphetamineMg: 0,
    terpeneMg: 0,
    itemCount: 0,
  };
}

function addTotals(target: MetricTotals, source: MetricTotals, multiplier = 1) {
  target.spend += source.spend * multiplier;
  target.calories += source.calories * multiplier;
  target.proteinG += source.proteinG * multiplier;
  target.carbsG += source.carbsG * multiplier;
  target.fatG += source.fatG * multiplier;
  target.cannabisG += source.cannabisG * multiplier;
  target.otherControlledG += source.otherControlledG * multiplier;
  target.alcoholG += source.alcoholG * multiplier;
  target.caffeineMg += source.caffeineMg * multiplier;
  target.thcMg += source.thcMg * multiplier;
  target.cbdMg += source.cbdMg * multiplier;
  target.cbnMg += source.cbnMg * multiplier;
  target.cbgMg += source.cbgMg * multiplier;
  target.amphetamineMg += source.amphetamineMg * multiplier;
  target.terpeneMg += source.terpeneMg * multiplier;
  target.itemCount += source.itemCount * multiplier;
}

function divideTotals(source: MetricTotals, divisor: number) {
  const total = emptyTotals();
  if (divisor <= 0) return total;
  addTotals(total, source, 1 / divisor);
  return total;
}

function parseMeta(value: string | null | undefined): NutritionMeta {
  if (!value) return {};
  try {
    return JSON.parse(value) as NutritionMeta;
  } catch {
    return {};
  }
}

function packageGramsFromName(name: string) {
  const multi = name.match(/\b(\d+(?:\.\d+)?)\s*[xX]\s*(\d+(?:\.\d+)?)\s*g(?:rams?)?\b/i);
  if (multi) return Number(multi[1]) * Number(multi[2]);

  const grams =
    name.match(/\((\d+(?:\.\d+)?)\s*g(?:rams?)?\)/i) ??
    name.match(/\b(\d+(?:\.\d+)?)\s*g(?:rams?)?\b/i);
  return grams ? Number(grams[1]) : null;
}

function activePackageGrams(
  item: { rawName: string; quantity: number; unit: string; totalGrams: number | null },
  meta: NutritionMeta,
) {
  if (item.totalGrams != null && item.totalGrams > 0) return item.totalGrams;
  if (meta.packageGrams != null && meta.packageGrams > 0) return meta.packageGrams;
  if (item.unit.toLowerCase() === "g" && item.quantity > 1) return item.quantity;
  return packageGramsFromName(item.rawName);
}

function resolvedReceiptDate(receipt: {
  purchasedAt: string | null;
  rawInputRef: string | null;
}) {
  return (
    normalizeReceiptDate(receipt.purchasedAt) ??
    inferPurchasedDateFromText(receipt.rawInputRef)
  );
}

function categoryLabel(key: CategoryKey) {
  return CATEGORY_OPTIONS.find((option) => option.key === key)?.label ?? "All categories";
}

async function getTrendRows() {
  return Promise.all([
    db
      .select({
        id: schema.receipts.id,
        vendor: schema.receipts.vendor,
        purchasedAt: schema.receipts.purchasedAt,
        total: schema.receipts.total,
        rawInputRef: schema.receipts.rawInputRef,
        createdAt: schema.receipts.createdAt,
      })
      .from(schema.receipts)
      .orderBy(desc(schema.receipts.createdAt)),
    db
      .select({
        id: schema.lineItems.id,
        receiptId: schema.lineItems.receiptId,
        rawName: schema.lineItems.rawName,
        category: schema.lineItems.category,
        quantity: schema.lineItems.quantity,
        unit: schema.lineItems.unit,
        price: schema.lineItems.price,
        receiptVendor: schema.receipts.vendor,
        receiptPurchasedAt: schema.receipts.purchasedAt,
        receiptRawInputRef: schema.receipts.rawInputRef,
        catalogCategory: schema.productCatalog.category,
        totalGrams: schema.nutritionFacts.totalGrams,
        calories: schema.nutritionFacts.calories,
        proteinG: schema.nutritionFacts.proteinG,
        carbsG: schema.nutritionFacts.carbsG,
        fatG: schema.nutritionFacts.fatG,
        alcoholG: schema.nutritionFacts.alcoholG,
        caffeineMg: schema.nutritionFacts.caffeineMg,
        activeIngredientsJson: schema.nutritionFacts.activeIngredientsJson,
      })
      .from(schema.lineItems)
      .innerJoin(schema.receipts, eq(schema.receipts.id, schema.lineItems.receiptId))
      .leftJoin(schema.productCatalog, eq(schema.productCatalog.id, schema.lineItems.productId))
      .leftJoin(schema.nutritionFacts, eq(schema.nutritionFacts.lineItemId, schema.lineItems.id))
      .orderBy(desc(schema.receipts.createdAt), asc(schema.lineItems.id)),
  ]);
}

type TrendRows = Awaited<ReturnType<typeof getTrendRows>>;
type ReceiptRow = TrendRows[0][number] & { resolvedDate: string | null };
type ItemRow = TrendRows[1][number] & { receiptDate: string | null };
type Interval = {
  id: string;
  vendorKey: string;
  startDate: string;
  endDate: string;
  days: number;
  receipt: ReceiptRow;
  totals: MetricTotals;
  daily: MetricTotals;
};

type TrendBucket = {
  key: string;
  label: string;
  start: string;
  end: string;
  days: number;
  receiptSpend: number;
  selectedSpend: number;
  selectedDailySpend: number;
  controlledSpend: number;
  controlledDailySpend: number;
  cannabisSpend: number;
  alcoholSpend: number;
  otherControlledSpend: number;
  cannabisG: number;
  cannabisDailyG: number;
  alcoholG: number;
  alcoholDailyG: number;
  otherControlledG: number;
  otherControlledDailyG: number;
  controlledTotals: MetricTotals;
  estimatedTotals: MetricTotals;
  estimatedDaily: MetricTotals;
  receiptCount: number;
  itemCount: number;
};

function itemTotals(item: ItemRow) {
  const totals = emptyTotals();
  const meta = parseMeta(item.activeIngredientsJson);
  const active = meta.active;
  const per100gOnly = meta.basis === "per_100g_reference_only";
  const calories = per100gOnly ? meta.per100g?.calories : item.calories;
  const proteinG = per100gOnly ? meta.per100g?.proteinG : item.proteinG;
  const carbsG = per100gOnly ? meta.per100g?.carbsG : item.carbsG;
  const fatG = per100gOnly ? meta.per100g?.fatG : item.fatG;
  const alcoholG = per100gOnly ? meta.per100g?.alcoholG : item.alcoholG ?? active?.alcoholG;
  const caffeineMg = per100gOnly
    ? meta.per100g?.caffeineMg
    : item.caffeineMg ?? active?.caffeineMg;
  const thcMg = active?.thcMg ?? active?.totalThcMg;
  const cbdMg = active?.cbdMg ?? active?.totalCbdMg;

  totals.itemCount = 1;
  totals.calories = finite(calories);
  totals.proteinG = finite(proteinG);
  totals.carbsG = finite(carbsG);
  totals.fatG = finite(fatG);
  totals.alcoholG = finite(alcoholG);
  totals.caffeineMg = finite(caffeineMg);
  totals.thcMg = finite(thcMg);
  totals.cbdMg = finite(cbdMg);
  totals.cbnMg = finite(active?.cbnMg);
  totals.cbgMg = finite(active?.cbgMg);
  totals.amphetamineMg = finite(active?.amphetamineMg);
  totals.terpeneMg = finite(active?.terpeneMg);

  if (isCannabisItem(item, totals, meta)) {
    totals.cannabisG = finite(activePackageGrams(item, meta));
  }

  if (isOtherControlledItem(meta, totals)) {
    totals.otherControlledG = totals.amphetamineMg / 1000;
  }

  return totals;
}

function isCannabisItem(item: ItemRow, totals = emptyTotals(), meta = parseMeta(item.activeIngredientsJson)) {
  return (
    item.category === "cannabis" ||
    item.catalogCategory === "cannabis" ||
    meta.entryType === "cannabis" ||
    totals.thcMg > 0 ||
    totals.cbdMg > 0 ||
    totals.cbnMg > 0 ||
    totals.cbgMg > 0 ||
    totals.terpeneMg > 0 ||
    ACTIVE_ITEM_SIGNAL_RE.test(`${item.receiptVendor ?? ""} ${item.rawName}`)
  );
}

function isAlcoholItem(item: ItemRow, totals = emptyTotals(), meta = parseMeta(item.activeIngredientsJson)) {
  return (
    totals.alcoholG > 0 ||
    meta.entryType === "alcohol" ||
    ALCOHOL_ITEM_SIGNAL_RE.test(`${item.receiptVendor ?? ""} ${item.rawName}`)
  );
}

function isOtherControlledItem(meta: NutritionMeta, totals = emptyTotals()) {
  return meta.entryType === "medication" || totals.amphetamineMg > 0;
}

function isControlledItem(item: ItemRow, totals = itemTotals(item), meta = parseMeta(item.activeIngredientsJson)) {
  return isCannabisItem(item, totals, meta) || isAlcoholItem(item, totals, meta) || isOtherControlledItem(meta, totals);
}

function receiptTotals(receipt: ReceiptRow, items: ItemRow[]) {
  const totals = emptyTotals();
  totals.spend = receipt.total ?? items.reduce((sum, item) => sum + (item.price ?? 0), 0);
  for (const item of items) addTotals(totals, itemTotals(item));
  return totals;
}

function trendCategory(item: ItemRow): CategoryKey {
  const totals = itemTotals(item);
  if (isControlledItem(item, totals)) return "controlled";
  const value = item.category ?? item.catalogCategory;
  if (
    value === "food" ||
    value === "drink" ||
    value === "supplement" ||
    value === "household" ||
    value === "personal_care"
  ) {
    return value;
  }
  return "other";
}

function buildItemMaps(items: ItemRow[]) {
  const byReceiptId = new Map<number, ItemRow[]>();
  for (const item of items) {
    const list = byReceiptId.get(item.receiptId) ?? [];
    list.push(item);
    byReceiptId.set(item.receiptId, list);
  }
  return byReceiptId;
}

function buildDuplicateGroups(receipts: ReceiptRow[], itemsByReceiptId: Map<number, ItemRow[]>) {
  const bySignature = new Map<string, ReceiptRow[]>();
  for (const receipt of receipts) {
    const items = itemsByReceiptId.get(receipt.id) ?? [];
    const signature =
      receiptDedupeSignature(
        {
          vendor: receipt.vendor,
          purchasedAt: receipt.resolvedDate,
          total: receipt.total,
        },
        items.map((item) => ({
          rawName: item.rawName,
          quantity: item.quantity,
          unit: item.unit,
          price: item.price,
        })),
      ) ??
      receiptHeaderSignature({
        vendor: receipt.vendor,
        purchasedAt: receipt.resolvedDate,
        total: receipt.total,
      });
    if (!signature) continue;
    const group = bySignature.get(signature) ?? [];
    group.push(receipt);
    bySignature.set(signature, group);
  }

  return [...bySignature.values()]
    .filter((group) => group.length > 1)
    .map((group) => [...group].sort((a, b) => a.id - b.id));
}

function buildPrimaryReceiptIds(receipts: ReceiptRow[], duplicateGroups: ReceiptRow[][]) {
  const ids = new Set(receipts.map((receipt) => receipt.id));
  for (const group of duplicateGroups) {
    const [primary, ...duplicates] = group;
    ids.add(primary.id);
    for (const receipt of duplicates) ids.delete(receipt.id);
  }
  return ids;
}

function vendorKey(vendor: string | null) {
  const raw = vendor?.trim() || "unknown";
  return raw
    .toLowerCase()
    .replace(/\s+-\s*order\s*#?\s*[a-z0-9-]+/g, "")
    .replace(/\border\s*#?\s*[a-z0-9-]+/g, "")
    .replace(/#[a-z0-9-]+/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim() || "unknown";
}

function median(values: number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[middle - 1] + sorted[middle]) / 2)
    : sorted[middle];
}

function clampedIntervalDays(days: number | null) {
  if (!days || days <= 0) return null;
  return Math.min(Math.max(Math.round(days), 1), 365);
}

function buildIntervals(
  receipts: ReceiptRow[],
  itemsByReceiptId: Map<number, ItemRow[]>,
  primaryReceiptIds: Set<number>,
) {
  const grouped = new Map<
    string,
    Array<{
      receipt: ReceiptRow;
      date: string;
      key: string;
      totals: MetricTotals;
    }>
  >();

  for (const receipt of receipts) {
    if (!primaryReceiptIds.has(receipt.id) || !receipt.resolvedDate) continue;
    const key = vendorKey(receipt.vendor);
    const items = itemsByReceiptId.get(receipt.id) ?? [];
    const totals = receiptTotals(receipt, items);
    const hasControlledAmount = totals.cannabisG > 0 || totals.alcoholG > 0 || totals.otherControlledG > 0;
    if (totals.spend <= 0 && totals.calories <= 0 && !hasControlledAmount) continue;

    const group = grouped.get(key) ?? [];
    group.push({ receipt, date: receipt.resolvedDate, key, totals });
    grouped.set(key, group);
  }

  const intervals: Interval[] = [];
  for (const group of grouped.values()) {
    const sorted = [...group].sort((a, b) => a.date.localeCompare(b.date) || a.receipt.id - b.receipt.id);
    const gaps = sorted
      .slice(0, -1)
      .map((entry, index) => daysBetween(entry.date, sorted[index + 1].date))
      .filter((days) => days > 0);
    const expectedDays = clampedIntervalDays(median(gaps)) ?? 7;

    sorted.forEach((entry, index) => {
      const next = sorted[index + 1];
      const days = clampedIntervalDays(next ? daysBetween(entry.date, next.date) : expectedDays);
      if (!days) return;
      intervals.push({
        id: `${entry.key}-${entry.receipt.id}-${entry.date}`,
        vendorKey: entry.key,
        startDate: entry.date,
        endDate: addDays(entry.date, days - 1),
        days,
        receipt: entry.receipt,
        totals: entry.totals,
        daily: divideTotals(entry.totals, days),
      });
    });
  }
  return intervals;
}

function intervalOverlapDays(interval: Interval, start: string, end: string) {
  const overlapStart = maxIso(interval.startDate, start);
  const overlapEnd = minIso(interval.endDate, end);
  if (overlapStart > overlapEnd) return 0;
  return daysBetween(overlapStart, overlapEnd) + 1;
}

function buildTrendBuckets({
  keys,
  bucket,
  category,
  start,
  end,
  receipts,
  intervals,
  itemsByReceiptId,
}: {
  keys: string[];
  bucket: BucketMode;
  category: CategoryKey;
  start: string;
  end: string;
  receipts: ReceiptRow[];
  intervals: Interval[];
  itemsByReceiptId: Map<number, ItemRow[]>;
}) {
  const byKey = new Map<string, TrendBucket>();
  for (const key of keys) {
    const range = bucketRange(key, bucket);
    const clippedStart = maxIso(range.start, start);
    const clippedEnd = minIso(range.end, end);
    byKey.set(key, {
      key,
      label: formatBucketLabel(key, bucket),
      start: clippedStart,
      end: clippedEnd,
      days: periodDays(clippedStart, clippedEnd),
      receiptSpend: 0,
      selectedSpend: 0,
      selectedDailySpend: 0,
      controlledSpend: 0,
      controlledDailySpend: 0,
      cannabisSpend: 0,
      alcoholSpend: 0,
      otherControlledSpend: 0,
      cannabisG: 0,
      cannabisDailyG: 0,
      alcoholG: 0,
      alcoholDailyG: 0,
      otherControlledG: 0,
      otherControlledDailyG: 0,
      controlledTotals: emptyTotals(),
      estimatedTotals: emptyTotals(),
      estimatedDaily: emptyTotals(),
      receiptCount: 0,
      itemCount: 0,
    });
  }

  for (const receipt of receipts) {
    if (!receipt.resolvedDate) continue;
    const row = byKey.get(bucketKey(receipt.resolvedDate, bucket));
    if (!row) continue;
    const items = itemsByReceiptId.get(receipt.id) ?? [];
    const itemSpend = items.reduce((sum, item) => sum + (item.price ?? 0), 0);
    const receiptSpend = receipt.total ?? itemSpend;
    row.receiptSpend += receiptSpend;
    row.receiptCount += 1;

    if (category === "all") {
      row.selectedSpend += receiptSpend;
    }

    for (const item of items) {
      row.itemCount += 1;
      const totals = itemTotals(item);
      const itemCategory = trendCategory(item);
      const price = item.price ?? 0;

      if (category !== "all" && itemCategory === category) {
        row.selectedSpend += price;
      }

      if (itemCategory === "controlled") {
        const meta = parseMeta(item.activeIngredientsJson);
        row.controlledSpend += price;
        if (isCannabisItem(item, totals, meta)) {
          row.cannabisSpend += price;
          row.cannabisG += totals.cannabisG;
        } else if (isAlcoholItem(item, totals, meta)) {
          row.alcoholSpend += price;
          row.alcoholG += totals.alcoholG;
        } else {
          row.otherControlledSpend += price;
          row.otherControlledG += totals.otherControlledG;
        }
        addTotals(row.controlledTotals, totals);
      }
    }
  }

  for (const interval of intervals) {
    for (const row of byKey.values()) {
      const overlap = intervalOverlapDays(interval, row.start, row.end);
      if (overlap > 0) addTotals(row.estimatedTotals, interval.daily, overlap);
    }
  }

  for (const row of byKey.values()) {
    row.selectedDailySpend = row.selectedSpend / row.days;
    row.controlledDailySpend = row.controlledSpend / row.days;
    row.cannabisDailyG = row.cannabisG / row.days;
    row.alcoholDailyG = row.alcoholG / row.days;
    row.otherControlledDailyG = row.otherControlledG / row.days;
    row.estimatedDaily = divideTotals(row.estimatedTotals, row.days);
  }

  return [...byKey.values()];
}

function latestPair(rows: TrendBucket[], getValue: (row: TrendBucket) => number) {
  const nonZero = rows.filter((row) => getValue(row) > 0);
  return {
    latest: nonZero[nonZero.length - 1] ?? null,
    previous: nonZero[nonZero.length - 2] ?? null,
  };
}

function controlledSplitLine(row: TrendBucket, mode: "daily" | "total") {
  const cannabisG = mode === "daily" ? row.cannabisDailyG : row.cannabisG;
  const alcoholG = mode === "daily" ? row.alcoholDailyG : row.alcoholG;
  const otherG = mode === "daily" ? row.otherControlledDailyG : row.otherControlledG;
  return [
    cannabisG > 0 ? `🥬 ${formatGrams(cannabisG)}` : null,
    alcoholG > 0 ? `Alcohol ${formatGrams(alcoholG)}` : null,
    otherG > 0 ? `Other ${formatGrams(otherG)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function macroShares(totals: MetricTotals) {
  const protein = totals.proteinG * 4;
  const carbs = totals.carbsG * 4;
  const fat = totals.fatG * 9;
  const alcohol = totals.alcoholG * 7;
  const macroCalories = protein + carbs + fat + alcohol;
  if (macroCalories <= 0) return { protein: 0, carbs: 0, fat: 0, alcohol: 0 };
  return {
    protein: protein / macroCalories,
    carbs: carbs / macroCalories,
    fat: fat / macroCalories,
    alcohol: alcohol / macroCalories,
  };
}

function KpiCard({
  label,
  value,
  detail,
  icon,
  tone = "zinc",
}: {
  label: string;
  value: string;
  detail: string;
  icon: ReactNode;
  tone?: "zinc" | "amber" | "emerald";
}) {
  const iconClass =
    tone === "amber"
      ? "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
      : tone === "emerald"
        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
        : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300";
  return (
    <div className="min-w-0 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-start justify-between gap-3">
        <div className="text-xs font-medium uppercase text-zinc-500">{label}</div>
        <div className={`rounded-md p-2 ${iconClass}`}>{icon}</div>
      </div>
      <div className="mt-5 break-words text-2xl font-semibold tracking-normal">{value}</div>
      <div className="mt-1 text-sm text-zinc-500">{detail}</div>
    </div>
  );
}

function SegmentLinks<T extends string>({
  options,
  value,
  hrefFor,
}: {
  options: Array<{ key: T; label: string }>;
  value: T;
  hrefFor: (key: T) => string;
}) {
  return (
    <div className="flex w-full max-w-full flex-wrap rounded-lg border border-zinc-200 bg-white p-1 dark:border-zinc-800 dark:bg-zinc-900 sm:inline-flex sm:w-auto">
      {options.map((option) => (
        <Link
          key={option.key}
          href={hrefFor(option.key)}
          prefetch={false}
          className={`min-w-0 flex-1 rounded-md px-3 py-1.5 text-center text-sm font-medium sm:flex-none ${
            value === option.key
              ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
              : "text-zinc-600 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800"
          }`}
        >
          {option.label}
        </Link>
      ))}
    </div>
  );
}

function SectionHeader({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
      <h2 className="text-sm font-semibold">{title}</h2>
      {detail ? <div className="mt-1 text-xs text-zinc-500">{detail}</div> : null}
    </div>
  );
}

function SpendTrendRows({
  rows,
  maxValue,
  valueFor,
  detailFor,
}: {
  rows: TrendBucket[];
  maxValue: number;
  valueFor: (row: TrendBucket) => number;
  detailFor: (row: TrendBucket) => string;
}) {
  const visibleRows = rows.filter((row) => valueFor(row) > 0 || row.receiptCount > 0).slice(-18);
  return (
    <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
      {visibleRows.map((row) => {
        const value = valueFor(row);
        return (
          <div key={row.key} className="grid gap-3 px-4 py-3 sm:grid-cols-[120px_1fr_110px] sm:items-center">
            <div className="text-sm font-medium text-zinc-600 dark:text-zinc-400">{row.label}</div>
            <div className="h-3 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
              <div
                className="h-full rounded-full bg-emerald-500"
                style={{ width: `${Math.max((value / maxValue) * 100, value > 0 ? 3 : 0)}%` }}
              />
            </div>
            <div className="text-left sm:text-right">
              <div className="text-sm font-medium">{formatDailyMoney(value)}</div>
              <div className="mt-0.5 text-xs text-zinc-500">{detailFor(row)}</div>
            </div>
          </div>
        );
      })}
      {visibleRows.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-zinc-500">No dated spend in this range.</div>
      ) : null}
    </div>
  );
}

function ControlledTrendRows({ rows }: { rows: TrendBucket[] }) {
  const visibleRows = rows
    .filter(
      (row) =>
        row.controlledSpend > 0 ||
        row.cannabisG > 0 ||
        row.alcoholG > 0 ||
        row.otherControlledG > 0,
    )
    .slice(-18);
  const maxSpend = Math.max(...visibleRows.map((row) => row.controlledDailySpend), 1);
  const maxCannabis = Math.max(...visibleRows.map((row) => row.cannabisDailyG), 1);
  const maxAlcohol = Math.max(...visibleRows.map((row) => row.alcoholDailyG), 1);
  const maxOther = Math.max(...visibleRows.map((row) => row.otherControlledDailyG), 1);
  return (
    <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
      {visibleRows.map((row) => (
        <div key={row.key} className="grid gap-3 px-4 py-3 sm:grid-cols-[120px_1fr_210px] sm:items-center">
          <div className="text-sm font-medium text-zinc-600 dark:text-zinc-400">{row.label}</div>
          <div className="grid gap-1.5">
            <div className="h-3 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
              <div
                className="h-full rounded-full bg-emerald-500"
                style={{
                  width: `${Math.max(
                    (row.controlledDailySpend / maxSpend) * 100,
                    row.controlledDailySpend > 0 ? 3 : 0,
                  )}%`,
                }}
              />
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
              <div
                className="h-full rounded-full bg-amber-500"
                style={{
                  width: `${Math.max(
                    (row.cannabisDailyG / maxCannabis) * 100,
                    row.cannabisDailyG > 0 ? 3 : 0,
                  )}%`,
                }}
              />
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
              <div
                className="h-full rounded-full bg-rose-500"
                style={{
                  width: `${Math.max(
                    (row.alcoholDailyG / maxAlcohol) * 100,
                    row.alcoholDailyG > 0 ? 3 : 0,
                  )}%`,
                }}
              />
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
              <div
                className="h-full rounded-full bg-violet-500"
                style={{
                  width: `${Math.max(
                    (row.otherControlledDailyG / maxOther) * 100,
                    row.otherControlledDailyG > 0 ? 3 : 0,
                  )}%`,
                }}
              />
            </div>
          </div>
          <div className="text-left sm:text-right">
            <div className="text-sm font-medium">{formatDailyMoney(row.controlledDailySpend)}</div>
            <div className="mt-0.5 text-xs text-zinc-500">
              {controlledSplitLine(row, "daily") || "amount pending"}
            </div>
            <div className="mt-0.5 text-xs text-zinc-400">
              total {formatMoney(row.controlledSpend)}
            </div>
          </div>
        </div>
      ))}
      {visibleRows.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-zinc-500">No controlled rows in this range.</div>
      ) : null}
      {visibleRows.length > 0 ? (
        <div className="flex flex-wrap gap-3 px-4 py-3 text-xs text-zinc-500">
          <span className="inline-flex items-center gap-1">
            <span className="size-2 rounded-full bg-emerald-500" />
            Known spend
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="size-2 rounded-full bg-amber-500" />
            🥬 package grams/day
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="size-2 rounded-full bg-rose-500" />
            Alcohol grams/day
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="size-2 rounded-full bg-violet-500" />
            Other grams/day
          </span>
        </div>
      ) : null}
    </div>
  );
}

function NutritionRows({ rows }: { rows: TrendBucket[] }) {
  const visibleRows = rows
    .filter((row) => row.estimatedDaily.calories > 0 || row.estimatedDaily.proteinG > 0)
    .slice(-18);
  const maxCalories = Math.max(...visibleRows.map((row) => row.estimatedDaily.calories), 1);
  return (
    <div className="max-w-full overflow-x-auto">
      <table className="w-full min-w-[820px] text-sm">
        <thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-500 dark:bg-zinc-800/50">
          <tr>
            <th className="px-4 py-3 font-medium">Period</th>
            <th className="px-4 py-3 font-medium">Calories/day</th>
            <th className="px-4 py-3 font-medium">Macro makeup</th>
            <th className="px-4 py-3 text-right font-medium">Protein</th>
            <th className="px-4 py-3 text-right font-medium">Carbs</th>
            <th className="px-4 py-3 text-right font-medium">Fat</th>
            <th className="px-4 py-3 text-right font-medium">Other actives</th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((row) => {
            const shares = macroShares(row.estimatedDaily);
            return (
              <tr key={row.key} className="border-t border-zinc-100 dark:border-zinc-800">
                <td className="px-4 py-3 font-medium text-zinc-600 dark:text-zinc-400">{row.label}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-24 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                      <div
                        className="h-full rounded-full bg-sky-500"
                        style={{
                          width: `${Math.max((row.estimatedDaily.calories / maxCalories) * 100, row.estimatedDaily.calories > 0 ? 3 : 0)}%`,
                        }}
                      />
                    </div>
                    <span className="font-medium">{formatMetric(row.estimatedDaily.calories, 0)}</span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex h-3 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                    <div className="bg-emerald-500" style={{ width: `${shares.protein * 100}%` }} />
                    <div className="bg-sky-500" style={{ width: `${shares.carbs * 100}%` }} />
                    <div className="bg-amber-500" style={{ width: `${shares.fat * 100}%` }} />
                    <div className="bg-rose-500" style={{ width: `${shares.alcohol * 100}%` }} />
                  </div>
                </td>
                <td className="px-4 py-3 text-right">{formatMetric(row.estimatedDaily.proteinG)}g</td>
                <td className="px-4 py-3 text-right">{formatMetric(row.estimatedDaily.carbsG)}g</td>
                <td className="px-4 py-3 text-right">{formatMetric(row.estimatedDaily.fatG)}g</td>
                <td className="px-4 py-3 text-right text-zinc-500">
                  {[
                    row.estimatedDaily.alcoholG > 0 ? formatAlcoholOz(row.estimatedDaily.alcoholG) : null,
                    row.estimatedDaily.caffeineMg > 0 ? formatMg(row.estimatedDaily.caffeineMg) : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "-"}
                </td>
              </tr>
            );
          })}
          {visibleRows.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-4 py-8 text-center text-sm text-zinc-500">
                Nutrition trends need matched or manual nutrition totals.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

export default async function TrendsPage({
  searchParams,
}: {
  searchParams: Promise<{
    range?: string | string[];
    bucket?: string | string[];
    category?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const range = parseRange(params.range);
  const bucket = parseBucket(params.bucket);
  const category = parseCategory(params.category);
  const cookieStore = await cookies();
  const timeZone = timeZoneFromCookie(cookieStore.get(TIME_ZONE_COOKIE)?.value);
  const today = todayIsoInTimeZone(timeZone);
  const rawStart = rangeStart(range, today);
  const [rawReceipts, rawItems] = await getTrendRows();
  const receipts: ReceiptRow[] = rawReceipts.map((receipt) => ({
    ...receipt,
    resolvedDate: resolvedReceiptDate(receipt),
  }));
  const items: ItemRow[] = rawItems.map((item) => ({
    ...item,
    receiptDate:
      normalizeReceiptDate(item.receiptPurchasedAt) ??
      inferPurchasedDateFromText(item.receiptRawInputRef),
  }));
  const itemsByReceiptId = buildItemMaps(items);
  const duplicateGroups = buildDuplicateGroups(receipts, itemsByReceiptId);
  const primaryReceiptIds = buildPrimaryReceiptIds(receipts, duplicateGroups);
  const primaryReceipts = receipts.filter((receipt) => primaryReceiptIds.has(receipt.id));
  const datedReceipts = primaryReceipts.filter((receipt) => receipt.resolvedDate);
  const firstDate = datedReceipts.map((receipt) => receipt.resolvedDate).sort()[0] ?? today;
  const start = rawStart ? maxIso(rawStart, firstDate) : firstDate;
  const keys = buildBucketKeys(start, today, bucket);
  const rangeReceipts = primaryReceipts.filter((receipt) => inPeriod(receipt.resolvedDate, start, today));
  const intervals = buildIntervals(primaryReceipts, itemsByReceiptId, primaryReceiptIds);
  const rows = buildTrendBuckets({
    keys,
    bucket,
    category,
    start,
    end: today,
    receipts: rangeReceipts,
    intervals,
    itemsByReceiptId,
  });

  const selectedLabel = categoryLabel(category);
  const selectedPair = latestPair(rows, (row) => row.selectedDailySpend);
  const selectedDelta =
    selectedPair.latest && selectedPair.previous
      ? selectedPair.latest.selectedDailySpend - selectedPair.previous.selectedDailySpend
      : 0;
  const controlledPair = latestPair(rows, (row) => row.controlledDailySpend);
  const controlledDelta =
    controlledPair.latest && controlledPair.previous
      ? controlledPair.latest.controlledDailySpend - controlledPair.previous.controlledDailySpend
      : 0;
  const cannabisPair = latestPair(rows, (row) => row.cannabisDailyG);
  const cannabisDelta =
    cannabisPair.latest && cannabisPair.previous
      ? cannabisPair.latest.cannabisDailyG - cannabisPair.previous.cannabisDailyG
      : 0;
  const alcoholPair = latestPair(rows, (row) => row.alcoholDailyG);
  const alcoholDelta =
    alcoholPair.latest && alcoholPair.previous
      ? alcoholPair.latest.alcoholDailyG - alcoholPair.previous.alcoholDailyG
      : 0;
  const otherControlledPair = latestPair(rows, (row) => row.otherControlledDailyG);
  const otherControlledDelta =
    otherControlledPair.latest && otherControlledPair.previous
      ? otherControlledPair.latest.otherControlledDailyG - otherControlledPair.previous.otherControlledDailyG
      : 0;
  const nutritionPair = latestPair(rows, (row) => row.estimatedDaily.calories);
  const latestMacro = nutritionPair.latest ? macroShares(nutritionPair.latest.estimatedDaily) : null;
  const previousMacro = nutritionPair.previous ? macroShares(nutritionPair.previous.estimatedDaily) : null;
  const latestNutrition = nutritionPair.latest?.estimatedDaily ?? emptyTotals();
  const selectedTotal = rows.reduce((sum, row) => sum + row.selectedSpend, 0);
  const controlledTotal = rows.reduce((sum, row) => sum + row.controlledSpend, 0);
  const cannabisTotal = rows.reduce((sum, row) => sum + row.cannabisG, 0);
  const alcoholTotal = rows.reduce((sum, row) => sum + row.alcoholG, 0);
  const otherControlledTotal = rows.reduce((sum, row) => sum + row.otherControlledG, 0);
  const controlledAmountTotalLine =
    [
      cannabisTotal > 0 ? `🥬 ${formatGrams(cannabisTotal)}` : null,
      alcoholTotal > 0 ? `Alcohol ${formatGrams(alcoholTotal)}` : null,
      otherControlledTotal > 0 ? `Other ${formatGrams(otherControlledTotal)}` : null,
    ]
      .filter(Boolean)
      .join(" · ") || "Amounts pending";
  const excludedUndated = primaryReceipts.length - datedReceipts.length;
  const maxSelectedSpend = Math.max(...rows.map((row) => row.selectedDailySpend), 1);
  const kpiCards: Array<{
    key: string;
    label: string;
    value: string;
    detail: string;
    icon: ReactNode;
    tone?: "zinc" | "amber" | "emerald";
  } | null> = [
    selectedPair.latest
      ? {
          key: "selected",
          label: `${selectedLabel} / day`,
          value: formatDailyMoney(selectedPair.latest.selectedDailySpend),
          detail: selectedPair.previous
            ? `${formatSignedMoney(selectedDelta)}/day vs ${selectedPair.previous.label} · ${formatMoney(selectedTotal)} total`
            : `${formatMoney(selectedTotal)} total in range`,
          icon: selectedDelta > 0 ? <TrendingUp className="size-4" /> : <TrendingDown className="size-4" />,
          tone: selectedDelta > 0 ? "amber" : selectedDelta < 0 ? "emerald" : "zinc",
        }
      : null,
    controlledPair.latest
      ? {
          key: "controlled-spend",
          label: "Controlled / day",
          value: formatDailyMoney(controlledPair.latest.controlledDailySpend),
          detail: controlledPair.previous
            ? `${formatSignedMoney(controlledDelta)}/day vs ${controlledPair.previous.label} · ${formatMoney(controlledTotal)} total`
            : `${formatMoney(controlledTotal)} total in range`,
          icon: <PackageCheck className="size-4" />,
          tone: controlledDelta > 0 ? "amber" : controlledDelta < 0 ? "emerald" : "zinc",
        }
      : null,
    cannabisPair.latest
      ? {
          key: "package-g",
          label: "🥬 package / day",
          value: formatDailyGrams(cannabisPair.latest.cannabisDailyG),
          detail: cannabisPair.previous
            ? `${formatSignedMetric(cannabisDelta, "g")}/day vs ${cannabisPair.previous.label} · ${formatGrams(cannabisTotal)} total`
            : `${formatGrams(cannabisTotal)} total in range`,
          icon: <Gauge className="size-4" />,
          tone: cannabisDelta > 0 ? "amber" : cannabisDelta < 0 ? "emerald" : "zinc",
        }
      : null,
    alcoholPair.latest
      ? {
          key: "alcohol-g",
          label: "Alcohol / day",
          value: formatDailyGrams(alcoholPair.latest.alcoholDailyG),
          detail: alcoholPair.previous
            ? `${formatSignedMetric(alcoholDelta, "g")}/day vs ${alcoholPair.previous.label} · ${formatGrams(alcoholTotal)} total`
            : `${formatGrams(alcoholTotal)} total in range`,
          icon: <Wine className="size-4" />,
          tone: alcoholDelta > 0 ? "amber" : alcoholDelta < 0 ? "emerald" : "zinc",
        }
      : null,
    otherControlledPair.latest
      ? {
          key: "other-g",
          label: "Other active / day",
          value: formatDailyGrams(otherControlledPair.latest.otherControlledDailyG),
          detail: otherControlledPair.previous
            ? `${formatSignedMetric(otherControlledDelta, "g")}/day vs ${otherControlledPair.previous.label} · ${formatGrams(otherControlledTotal)} total`
            : `${formatGrams(otherControlledTotal)} total in range`,
          icon: <Pill className="size-4" />,
          tone: otherControlledDelta > 0 ? "amber" : otherControlledDelta < 0 ? "emerald" : "zinc",
        }
      : null,
    {
      key: "nutrition",
      label: "Nutrition makeup",
      value:
        latestNutrition.calories > 0
          ? `${formatMetric(latestNutrition.calories, 0)} cal/day`
          : "Needs data",
      detail:
        latestMacro && previousMacro
          ? `P ${formatPctPoint(latestMacro.protein - previousMacro.protein)} · C ${formatPctPoint(
              latestMacro.carbs - previousMacro.carbs,
            )} · F ${formatPctPoint(latestMacro.fat - previousMacro.fat)}`
          : "Estimated from repeat windows",
      icon: <Utensils className="size-4" />,
    },
  ];
  const kpis = kpiCards.filter((card): card is NonNullable<typeof card> => Boolean(card));

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-zinc-500">
            <CalendarDays className="size-4" />
            {formatShortDate(start)} - {formatShortDate(today)} · {timeZone}
          </div>
          <h1 className="mt-2 text-3xl font-semibold tracking-normal">Trends</h1>
        </div>

        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <SegmentLinks
            options={RANGE_OPTIONS}
            value={range}
            hrefFor={(nextRange) => trendsHref({ range: nextRange, bucket, category })}
          />
          <SegmentLinks
            options={BUCKET_OPTIONS}
            value={bucket}
            hrefFor={(nextBucket) => trendsHref({ range, bucket: nextBucket, category })}
          />
          <Link
            href="/dashboard"
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800 sm:w-auto"
          >
            <ReceiptText className="size-4" />
            Dashboard
          </Link>
        </div>
      </div>

      {primaryReceipts.length === 0 ? (
        <section className="rounded-lg border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-xl font-semibold">No receipt data yet</h2>
          <p className="mt-2 text-sm text-zinc-500">Add a receipt or run the parser to populate this view.</p>
          <Link
            href="/"
            className="mt-5 inline-flex h-10 items-center gap-2 rounded-md bg-zinc-900 px-3 text-sm font-medium text-white hover:opacity-90 dark:bg-zinc-100 dark:text-zinc-900"
          >
            <ReceiptText className="size-4" />
            Add receipt
          </Link>
        </section>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
            {kpis.map((card) => (
              <KpiCard
                key={card.key}
                label={card.label}
                value={card.value}
                detail={card.detail}
                icon={card.icon}
                tone={card.tone}
              />
            ))}
          </div>

          <section className="min-w-0 rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <SectionHeader
              title="Calculation"
              detail="Each bucket is divided by the number of days it covers, so partial months and years compare as daily rates."
            />
            <div className="grid gap-3 p-4 text-sm text-zinc-600 dark:text-zinc-400 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
                <div className="font-medium text-zinc-900 dark:text-zinc-100">Spend/day</div>
                <p className="mt-1">All categories use receipt totals. Specific categories use known line item prices.</p>
              </div>
              <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
                <div className="font-medium text-zinc-900 dark:text-zinc-100">🥬 package grams/day</div>
                <p className="mt-1">Package grams come from product labels, item names, or manual entries when available.</p>
              </div>
              <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
                <div className="font-medium text-zinc-900 dark:text-zinc-100">Alcohol grams/day</div>
                <p className="mt-1">Alcohol is pure alcohol grams from nutrition matches or manual rows.</p>
              </div>
              <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
                <div className="font-medium text-zinc-900 dark:text-zinc-100">Other grams/day</div>
                <p className="mt-1">Other active amounts convert tracked milligrams to grams for comparison.</p>
              </div>
            </div>
          </section>

          <section className="min-w-0 rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex flex-col gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-sm font-semibold">Category change</h2>
                <div className="mt-1 text-xs text-zinc-500">
                  {rangeReceipts.length} dated receipts · {excludedUndated} without date
                </div>
              </div>
              <SegmentLinks
                options={CATEGORY_OPTIONS}
                value={category}
                hrefFor={(nextCategory) => trendsHref({ range, bucket, category: nextCategory })}
              />
            </div>
            <SpendTrendRows
              rows={rows}
              maxValue={maxSelectedSpend}
              valueFor={(row) => row.selectedDailySpend}
              detailFor={(row) =>
                category === "all"
                  ? `${formatMoney(row.selectedSpend)} total · ${row.receiptCount} receipts`
                  : `${formatMoney(row.selectedSpend)} total · line item prices`
              }
            />
          </section>

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]">
            <section className="min-w-0 rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
              <SectionHeader
                title="🥬 Controlled trend"
                detail={controlledAmountTotalLine}
              />
              <ControlledTrendRows rows={rows} />
            </section>

            <section className="min-w-0 rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
              <SectionHeader
                title="Macro differences"
                detail={
                  latestMacro
                    ? `Latest makeup: P ${formatPercent(latestMacro.protein)} · C ${formatPercent(
                        latestMacro.carbs,
                      )} · F ${formatPercent(latestMacro.fat)}`
                    : "No macro totals yet"
                }
              />
              <div className="grid gap-3 p-4">
                {latestMacro ? (
                  [
                    { label: "Protein", value: latestMacro.protein, color: "bg-emerald-500" },
                    { label: "Carbs", value: latestMacro.carbs, color: "bg-sky-500" },
                    { label: "Fat", value: latestMacro.fat, color: "bg-amber-500" },
                    { label: "Alcohol", value: latestMacro.alcohol, color: "bg-rose-500" },
                  ]
                    .filter((row) => row.value > 0)
                    .map((row) => (
                      <div key={row.label} className="grid grid-cols-[72px_minmax(0,1fr)_44px] items-center gap-2 sm:grid-cols-[80px_1fr_48px] sm:gap-3">
                        <div className="text-sm text-zinc-600 dark:text-zinc-400">{row.label}</div>
                        <div className="h-3 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                          <div className={`h-full rounded-full ${row.color}`} style={{ width: `${row.value * 100}%` }} />
                        </div>
                        <div className="text-right text-sm font-medium">{formatPercent(row.value)}</div>
                      </div>
                    ))
                ) : (
                  <div className="rounded-md border border-zinc-200 px-3 py-8 text-center text-sm text-zinc-500 dark:border-zinc-800">
                    Add nutrition matches to see macro differences.
                  </div>
                )}
              </div>
            </section>
          </div>

          <section className="min-w-0 rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <SectionHeader title="Nutrition trend" detail="Daily estimates from repeat purchase windows" />
            <NutritionRows rows={rows} />
          </section>
        </>
      )}
    </div>
  );
}
