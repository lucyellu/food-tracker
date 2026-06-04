import Link from "next/link";
import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { asc, desc, eq, sql } from "drizzle-orm";
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  Coffee,
  Database,
  Gauge,
  PackageCheck,
  Plus,
  ReceiptText,
  ShoppingBasket,
  TrendingUp,
  Utensils,
  Wine,
} from "lucide-react";
import { VendorMark } from "@/components/VendorMark";
import { db, schema } from "@/db/client";
import { isRateLimitError } from "@/lib/llm/errors";
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

type RangeKey = "1" | "7" | "30" | "90" | "365" | "all" | "custom";
type BuiltInPivotMode = "time" | "calories" | "budget";
type PivotMode = BuiltInPivotMode | "custom";
type DateRange = {
  start: string;
  end: string;
};

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
  { key: "1", label: "Day" },
  { key: "7", label: "Week" },
  { key: "30", label: "30d" },
  { key: "90", label: "90d" },
  { key: "365", label: "1y" },
  { key: "all", label: "All" },
  { key: "custom", label: "Custom" },
];

const PIVOT_OPTIONS: Array<{ key: BuiltInPivotMode; label: string; hint: string }> = [
  { key: "budget", label: "$", hint: "Compare spending against a daily spend target." },
  { key: "calories", label: "Calories", hint: "Estimate how long receipts last at a daily calorie target." },
  { key: "time", label: "Days", hint: "Stretch receipts over a set number of days." },
];

const SOURCE_LABEL: Record<string, string> = {
  manual_text: "pasted text",
  manual_email_paste: "pasted email",
  manual_image: "photo/PDF",
  auto_email: "auto email",
  google_photos: "Google Photos",
};

const ACTIVE_ITEM_SIGNAL_RE =
  /\b(dutch\s*love|thc|cbd|cbn|cbg|pre[-\s]?roll|preroll|flower|indica|sativa|hybrid|rosin|hash|vape|cart|edible|gumm(?:y|ies)|joint)\b/i;

const GRAMS_PER_OUNCE = 28.349523125;
const MAX_REASONABLE_LINE_GRAMS = 100_000;
const MAX_REASONABLE_LINE_CALORIES = 100_000;

function parseRange(value: string | string[] | undefined): RangeKey {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === "1" ||
    raw === "7" ||
    raw === "30" ||
    raw === "90" ||
    raw === "365" ||
    raw === "all" ||
    raw === "custom"
    ? raw
    : "90";
}

function parsePivot(value: string | string[] | undefined): PivotMode {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === "calories" || raw === "budget" || raw === "time" || raw === "custom" ? raw : "budget";
}

function parsePositiveNumber(
  value: string | string[] | undefined,
  fallback: number,
  min: number,
  max: number,
) {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function parseTextParam(value: string | string[] | undefined, fallback: string, maxLength = 24) {
  const raw = Array.isArray(value) ? value[0] : value;
  const cleaned = (raw ?? "")
    .replace(/[^\w $/().-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
  return cleaned || fallback;
}

function parseBooleanParam(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === "1" || raw === "true" || raw === "yes";
}

function dashboardHref({
  range,
  pivot,
  anchorDays,
  dailyCalories,
  dailySpendTarget,
  customAnchor,
  customLabel,
  customTarget,
  customUnit,
  start,
  end,
}: {
  range: RangeKey;
  pivot: PivotMode;
  anchorDays: number;
  dailyCalories: number;
  dailySpendTarget: number;
  customAnchor: boolean;
  customLabel: string;
  customTarget: number;
  customUnit: string;
  start?: string;
  end?: string;
}) {
  const params = new URLSearchParams({
    range,
    pivot,
    anchorDays: String(anchorDays),
    dailyCalories: String(dailyCalories),
    dailySpendTarget: String(dailySpendTarget),
  });
  if (customAnchor || pivot === "custom") {
    params.set("customAnchor", "1");
    params.set("customLabel", customLabel);
    params.set("customTarget", String(customTarget));
    params.set("customUnit", customUnit);
  }
  if (range === "custom") {
    if (start) params.set("start", start);
    if (end) params.set("end", end);
  }
  return `/dashboard?${params.toString()}`;
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

function maxIso(a: string, b: string) {
  return a > b ? a : b;
}

function minIso(a: string, b: string) {
  return a < b ? a : b;
}

function datePart(value: Date | string | null | undefined) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function parseDateParam(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : raw;
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

function rangeStart(range: RangeKey, today: string) {
  return range === "all" || range === "custom" ? null : addDays(today, -Number(range) + 1);
}

function resolveDateRange({
  range,
  today,
  firstDate,
  customStart,
  customEnd,
}: {
  range: RangeKey;
  today: string;
  firstDate: string;
  customStart: string | null;
  customEnd: string | null;
}): DateRange {
  if (range === "custom") {
    const rawStart = customStart ?? firstDate;
    const rawEnd = customEnd ?? today;
    return rawStart <= rawEnd
      ? { start: rawStart, end: rawEnd }
      : { start: rawEnd, end: rawStart };
  }

  return { start: rangeStart(range, today) ?? firstDate, end: today };
}

function periodDays(start: string | null, end: string) {
  return Math.max(daysBetween(start ?? end, end) + 1, 1);
}

function inPeriod(date: string | null, start: string | null, end: string) {
  return Boolean(date && (!start || date >= start) && date <= end);
}

function formatMoney(value: number) {
  return `$${value.toLocaleString(undefined, {
    maximumFractionDigits: value >= 100 ? 0 : 2,
  })}`;
}

function formatCustomTarget(value: number, unit: string) {
  const trimmed = unit.trim();
  if (trimmed.startsWith("$")) return `${formatMoney(value)}${trimmed.slice(1)}`;
  return `${formatMetric(value)} ${trimmed}`.trim();
}

function formatPercent(value: number) {
  if (!Number.isFinite(value)) return "0%";
  return `${Math.round(value * 100)}%`;
}

function formatMoneyExact(value: number | null) {
  return value == null ? "-" : `$${value.toFixed(2)}`;
}

function formatNumber(value: number, digits = 0) {
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function formatMetric(value: number) {
  if (value >= 1000) return formatNumber(value);
  if (value >= 100) return formatNumber(value, 0);
  return value.toFixed(1).replace(/\.0$/, "");
}

function formatGrams(value: number) {
  if (value >= 10) return `${formatNumber(value, 1)}g`;
  return `${formatNumber(value, 2)}g`;
}

function formatMg(value: number) {
  if (value >= 100) return `${formatNumber(value)}mg`;
  return `${formatNumber(value, 1)}mg`;
}

function formatAlcoholOz(value: number) {
  return `${formatNumber(value / GRAMS_PER_OUNCE, 2)}oz`;
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

function formatShortDate(value: string | null) {
  if (!value) return "No date";
  return new Date(`${value}T00:00:00.000Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
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
  target.terpeneMg += source.terpeneMg * multiplier;
  target.itemCount += source.itemCount * multiplier;
}

function divideTotals(source: MetricTotals, divisor: number) {
  const total = emptyTotals();
  if (divisor <= 0) return total;
  addTotals(total, source, 1 / divisor);
  return total;
}

function finite(value: number | null | undefined) {
  return value != null && Number.isFinite(value) ? value : 0;
}

function hasImplausibleNutrition(item: {
  totalGrams: number | null;
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
}) {
  return (
    finite(item.totalGrams) > MAX_REASONABLE_LINE_GRAMS ||
    finite(item.calories) > MAX_REASONABLE_LINE_CALORIES ||
    finite(item.proteinG) > MAX_REASONABLE_LINE_GRAMS ||
    finite(item.carbsG) > MAX_REASONABLE_LINE_GRAMS ||
    finite(item.fatG) > MAX_REASONABLE_LINE_GRAMS
  );
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

function titleCase(value: string) {
  return value.replace(/\b[a-z]/g, (char) => char.toUpperCase());
}

function safeDisplayText(value: string | null | undefined, fallback: string) {
  const safe = (value ?? "")
    .replace(/\b(?:cannabis|marijuana|weed)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+-\s+/g, " - ")
    .replace(/^-\s*|\s*-\s*$/g, "")
    .trim();
  return safe || fallback;
}

function vendorDisplayName(vendor: string | null | undefined) {
  return safeDisplayText(vendor, "Unknown");
}

function vendorBucket(vendor: string | null) {
  const raw = vendor?.trim() || "Unknown";
  const lower = raw.toLowerCase();
  if (/\b(?:t&t|tnt|tntsupermarket)\b/i.test(raw)) return { key: "tnt", label: "T&T Supermarket" };
  if (/costco/i.test(raw)) return { key: "costco", label: "Costco" };
  if (/price\s*smart|pricesmart|saveonfoods/i.test(raw)) {
    return { key: "pricesmart", label: "PriceSmart Foods" };
  }
  if (/uber\s*eats|\bubereats\b/i.test(raw)) return { key: "ubereats", label: "Uber Eats" };
  if (/dutch\s*love/i.test(raw)) return { key: "dutchlove", label: "Dutch Love" };

  const cleaned = lower
    .replace(/\s+-\s*order\s*#?\s*[a-z0-9-]+/g, "")
    .replace(/\border\s*#?\s*[a-z0-9-]+/g, "")
    .replace(/#[a-z0-9-]+/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  return {
    key: cleaned || "unknown",
    label: safeDisplayText(cleaned ? titleCase(cleaned) : raw, "Unknown"),
  };
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

function activeLine(totals: MetricTotals) {
  const metrics = [
    totals.thcMg > 0 ? `THC ${formatMg(totals.thcMg)}` : null,
    totals.cbdMg > 0 ? `CBD ${formatMg(totals.cbdMg)}` : null,
    totals.cbnMg > 0 ? `CBN ${formatMg(totals.cbnMg)}` : null,
    totals.cbgMg > 0 ? `CBG ${formatMg(totals.cbgMg)}` : null,
    totals.terpeneMg > 0 ? `Terp ${formatMg(totals.terpeneMg)}` : null,
  ].filter(Boolean);
  return metrics.slice(0, 3).join(" · ");
}

function otherActiveLine(totals: MetricTotals) {
  const metrics = [
    totals.otherControlledG > 0 ? `Non-cannabis ${formatGrams(totals.otherControlledG)}` : null,
  ].filter(Boolean);
  return metrics.join(" · ");
}

function macroLine(totals: MetricTotals) {
  return [
    totals.proteinG > 0 ? `P ${formatMetric(totals.proteinG)}g` : null,
    totals.carbsG > 0 ? `C ${formatMetric(totals.carbsG)}g` : null,
    totals.fatG > 0 ? `F ${formatMetric(totals.fatG)}g` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

async function getDashboardRows() {
  return Promise.all([
    db
      .select({
        id: schema.receipts.id,
        vendor: schema.receipts.vendor,
        purchasedAt: schema.receipts.purchasedAt,
        total: schema.receipts.total,
        source: schema.receipts.source,
        rawInputRef: sql<string | null>`null`,
        parseStatus: schema.receipts.parseStatus,
        parseError: schema.receipts.parseError,
        createdAt: schema.receipts.createdAt,
        itemCount: sql<number>`CAST(COUNT(${schema.lineItems.id}) AS INTEGER)`.as("item_count"),
      })
      .from(schema.receipts)
      .leftJoin(schema.lineItems, eq(schema.lineItems.receiptId, schema.receipts.id))
      .groupBy(schema.receipts.id)
      .orderBy(desc(schema.receipts.createdAt)),
    db
      .select({
        id: schema.lineItems.id,
        receiptId: schema.lineItems.receiptId,
        productId: schema.lineItems.productId,
        rawName: schema.lineItems.rawName,
        normalizedName: schema.lineItems.normalizedName,
        category: schema.lineItems.category,
        brand: schema.lineItems.brand,
        quantity: schema.lineItems.quantity,
        unit: schema.lineItems.unit,
        price: schema.lineItems.price,
        productImageUrl: schema.lineItems.productImageUrl,
        productUrl: schema.lineItems.productUrl,
        consumptionStatus: schema.lineItems.consumptionStatus,
        nutritionStatus: schema.lineItems.nutritionStatus,
        receiptVendor: schema.receipts.vendor,
        receiptPurchasedAt: schema.receipts.purchasedAt,
        receiptRawInputRef: sql<string | null>`null`,
        receiptCreatedAt: schema.receipts.createdAt,
        catalogName: schema.productCatalog.displayName,
        catalogCategory: schema.productCatalog.category,
        catalogImageUrl: schema.productCatalog.productImageUrl,
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
    db
      .select({
        status: schema.emailIngestLog.status,
        count: sql<number>`CAST(COUNT(*) AS INTEGER)`.as("count"),
        rateLimitedCount:
          sql<number>`CAST(COUNT(*) FILTER (WHERE lower(COALESCE(${schema.emailIngestLog.errorText}, '')) LIKE '%quota/rate limit%') AS INTEGER)`.as(
            "rate_limited_count",
          ),
      })
      .from(schema.emailIngestLog)
      .groupBy(schema.emailIngestLog.status),
    db
      .select({
        id: schema.emailIngestLog.id,
        receivedAt: schema.emailIngestLog.receivedAt,
        fromAddress: schema.emailIngestLog.fromAddress,
        subject: schema.emailIngestLog.subject,
        errorText: schema.emailIngestLog.errorText,
      })
      .from(schema.emailIngestLog)
      .where(eq(schema.emailIngestLog.status, "failed"))
      .orderBy(desc(schema.emailIngestLog.receivedAt))
      .limit(25),
  ]);
}

type DashboardRows = Awaited<ReturnType<typeof getDashboardRows>>;
type ReceiptRow = DashboardRows[0][number] & { resolvedDate: string | null };
type ItemRow = DashboardRows[1][number] & { receiptDate: string | null };
type Interval = {
  id: string;
  vendorKey: string;
  vendorLabel: string;
  startDate: string;
  endDate: string;
  days: number;
  projected: boolean;
  receipt: ReceiptRow;
  items: ItemRow[];
  totals: MetricTotals;
  daily: MetricTotals;
};

type KpiCardModel = {
  key: string;
  label: string;
  value: string;
  detail: string;
  icon: ReactNode;
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
  const amphetamineMg = active?.amphetamineMg;
  const hasLineTotalNutrition = !per100gOnly && !hasImplausibleNutrition(item);

  totals.itemCount = 1;
  totals.calories = hasLineTotalNutrition ? finite(calories) : 0;
  totals.proteinG = hasLineTotalNutrition ? finite(proteinG) : 0;
  totals.carbsG = hasLineTotalNutrition ? finite(carbsG) : 0;
  totals.fatG = hasLineTotalNutrition ? finite(fatG) : 0;
  totals.alcoholG = hasLineTotalNutrition ? finite(alcoholG) : 0;
  totals.caffeineMg = hasLineTotalNutrition ? finite(caffeineMg) : 0;
  totals.thcMg = finite(thcMg);
  totals.cbdMg = finite(cbdMg);
  totals.cbnMg = finite(active?.cbnMg);
  totals.cbgMg = finite(active?.cbgMg);
  totals.terpeneMg = finite(active?.terpeneMg);
  totals.otherControlledG = finite(amphetamineMg) / 1000;

  const cannabisItem =
    item.category === "cannabis" ||
    item.catalogCategory === "cannabis" ||
    meta.entryType === "cannabis" ||
    totals.thcMg > 0 ||
    totals.cbdMg > 0 ||
    totals.cbnMg > 0 ||
    totals.cbgMg > 0 ||
    totals.terpeneMg > 0 ||
    ACTIVE_ITEM_SIGNAL_RE.test(`${item.receiptVendor ?? ""} ${item.rawName}`);

  if (cannabisItem) {
    totals.cannabisG = finite(activePackageGrams(item, meta));
  }

  return totals;
}

function receiptTotals(receipt: ReceiptRow, items: ItemRow[]) {
  const totals = emptyTotals();
  totals.spend = receipt.total ?? items.reduce((sum, item) => sum + (item.price ?? 0), 0);
  for (const item of items) addTotals(totals, itemTotals(item));
  return totals;
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
    .map((group) => [...group].sort((a, b) => a.id - b.id))
    .sort((a, b) => (b[0].resolvedDate ?? "").localeCompare(a[0].resolvedDate ?? ""));
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
      vendorKey: string;
      vendorLabel: string;
      totals: MetricTotals;
    }>
  >();

  for (const receipt of receipts) {
    if (!primaryReceiptIds.has(receipt.id) || !receipt.resolvedDate) continue;
    const bucket = vendorBucket(receipt.vendor);
    const items = itemsByReceiptId.get(receipt.id) ?? [];
    const totals = receiptTotals(receipt, items);
    if (
      totals.spend <= 0 &&
      totals.calories <= 0 &&
      totals.cannabisG <= 0 &&
      totals.alcoholG <= 0 &&
      totals.otherControlledG <= 0
    ) continue;

    const group = grouped.get(bucket.key) ?? [];
    group.push({
      receipt,
      date: receipt.resolvedDate,
      vendorKey: bucket.key,
      vendorLabel: bucket.label,
      totals,
    });
    grouped.set(bucket.key, group);
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

function intervalDailyAverage(intervals: Interval[], start: string, end: string, days: number) {
  const total = emptyTotals();
  for (const interval of intervals) {
    const overlap = intervalOverlapDays(interval, start, end);
    if (overlap > 0) addTotals(total, interval.daily, overlap);
  }
  return divideTotals(total, days);
}

function buildWeeklyTrend(
  receipts: ReceiptRow[],
  intervals: Interval[],
  start: string,
  end: string,
) {
  const endDate = new Date(`${end}T00:00:00.000Z`);
  const currentWeekStart = addDays(end, -endDate.getUTCDay());
  return Array.from({ length: 8 }, (_, index) => {
    const weekStart = addDays(currentWeekStart, (index - 7) * 7);
    const weekEnd = minIso(addDays(weekStart, 6), end);
    const clippedStart = maxIso(weekStart, start);
    const spend = receipts
      .filter((receipt) => inPeriod(receipt.resolvedDate, clippedStart, weekEnd))
      .reduce((sum, receipt) => sum + (receipt.total ?? 0), 0);
    const daily = intervalDailyAverage(
      intervals,
      clippedStart,
      weekEnd,
      periodDays(clippedStart, weekEnd),
    );
    return {
      label: formatShortDate(weekStart).replace(", 2026", ""),
      start: weekStart,
      spend,
      calories: daily.calories,
      proteinG: daily.proteinG,
    };
  });
}

function buildRepeatVendors(intervals: Interval[], today: string) {
  const byVendor = new Map<string, Interval[]>();
  for (const interval of intervals) {
    const list = byVendor.get(interval.vendorKey) ?? [];
    list.push(interval);
    byVendor.set(interval.vendorKey, list);
  }

  return [...byVendor.entries()]
    .map(([key, list]) => {
      const sorted = [...list].sort((a, b) => a.startDate.localeCompare(b.startDate));
      const latest = sorted[sorted.length - 1];
      const avgDays = Math.round(
        sorted.reduce((sum, interval) => sum + interval.days, 0) / Math.max(sorted.length, 1),
      );
      return {
        key,
        label: latest.vendorLabel,
        orders: sorted.length,
        avgDays,
        latest,
        daysLeft: Math.max(daysBetween(today, latest.endDate) + 1, 0),
      };
    })
    .filter((vendor) => vendor.orders >= 2)
    .sort((a, b) => {
      const aDue = a.daysLeft === 0 ? -1 : a.daysLeft;
      const bDue = b.daysLeft === 0 ? -1 : b.daysLeft;
      return aDue - bDue;
    });
}

function imageUrlForItem(item: ItemRow) {
  return item.productImageUrl ?? item.catalogImageUrl ?? null;
}

function itemDisplayName(item: ItemRow) {
  const name = item.catalogName ?? item.rawName.replace(/^\[REFUNDED\]\s*/i, "");
  return safeDisplayText(name, "Controlled item");
}

function primaryCategory(item: ItemRow) {
  return item.category ?? item.catalogCategory ?? null;
}

function statusCount(rows: DashboardRows[2], status: string) {
  return Number(rows.find((row) => row.status === status)?.count ?? 0);
}

function statusRateLimitCount(rows: DashboardRows[2], status: string) {
  return Number(rows.find((row) => row.status === status)?.rateLimitedCount ?? 0);
}

function percentage(value: number) {
  return `${Math.round(Math.max(Math.min(value, 1), 0) * 100)}%`;
}

function KpiCard({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: string;
  detail?: string;
  icon: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-start justify-between gap-3">
        <div className="text-xs font-medium uppercase text-zinc-500">{label}</div>
        <div className="rounded-md bg-zinc-100 p-2 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
          {icon}
        </div>
      </div>
      <div className="mt-3 text-2xl font-semibold tracking-normal">{value}</div>
      {detail ? <div className="mt-1 text-sm text-zinc-500">{detail}</div> : null}
    </div>
  );
}

function pivotIcon(mode: PivotMode) {
  if (mode === "budget") return <ShoppingBasket className="size-4" />;
  if (mode === "calories") return <Utensils className="size-4" />;
  if (mode === "custom") return <Gauge className="size-4" />;
  return <CalendarDays className="size-4" />;
}

function PivotLinks({
  range,
  pivot,
  anchorDays,
  dailyCalories,
  dailySpendTarget,
  customAnchor,
  customLabel,
  customTarget,
  customUnit,
  start,
  end,
  variant = "compact",
}: {
  range: RangeKey;
  pivot: PivotMode;
  anchorDays: number;
  dailyCalories: number;
  dailySpendTarget: number;
  customAnchor: boolean;
  customLabel: string;
  customTarget: number;
  customUnit: string;
  start: string;
  end: string;
  variant?: "compact" | "section";
}) {
  const options = customAnchor
    ? [...PIVOT_OPTIONS, { key: "custom" as const, label: customLabel, hint: "Use a custom daily target." }]
    : PIVOT_OPTIONS;
  const addCustomHref = dashboardHref({
    range,
    pivot: "custom",
    anchorDays,
    dailyCalories,
    dailySpendTarget,
    customAnchor: true,
    customLabel,
    customTarget,
    customUnit,
    start,
    end,
  });

  return (
    <div
      className={
        variant === "section"
          ? "grid grid-cols-3 gap-2 sm:flex sm:flex-wrap"
          : "flex w-full flex-wrap rounded-lg border border-zinc-200 bg-white p-1 dark:border-zinc-800 dark:bg-zinc-900 sm:inline-flex sm:w-auto"
      }
    >
      {options.map((option) => (
        <Link
          key={option.key}
          href={dashboardHref({
            range,
            pivot: option.key,
            anchorDays,
            dailyCalories,
            dailySpendTarget,
            customAnchor,
            customLabel,
            customTarget,
            customUnit,
            start,
            end,
          })}
          prefetch={false}
          title={option.hint}
          className={
            variant === "section"
              ? `inline-flex min-w-0 items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-center text-sm font-medium ${
                  pivot === option.key
                    ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                    : "border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800"
                }`
              : `inline-flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-center text-sm font-medium sm:flex-none ${
                  pivot === option.key
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "text-zinc-600 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800"
                }`
          }
        >
          <span className="hidden sm:inline-flex">{pivotIcon(option.key)}</span>
          <span>{option.label}</span>
        </Link>
      ))}
      {!customAnchor ? (
        <Link
          href={addCustomHref}
          prefetch={false}
          title="Add custom anchor"
          className={
            variant === "section"
              ? "inline-flex min-w-0 items-center justify-center gap-1.5 rounded-md border border-dashed border-zinc-300 px-3 py-2 text-center text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
              : "inline-flex min-w-0 flex-1 items-center justify-center rounded-md px-3 py-1.5 text-center text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800 sm:flex-none"
          }
        >
          <Plus className="size-4" />
        </Link>
      ) : null}
    </div>
  );
}

function PivotInputForm({
  range,
  pivot,
  anchorDays,
  dailyCalories,
  dailySpendTarget,
  customAnchor,
  customLabel,
  customTarget,
  customUnit,
  start,
  end,
}: {
  range: RangeKey;
  pivot: PivotMode;
  anchorDays: number;
  dailyCalories: number;
  dailySpendTarget: number;
  customAnchor: boolean;
  customLabel: string;
  customTarget: number;
  customUnit: string;
  start: string;
  end: string;
}) {
  const common = (
    <>
      <input type="hidden" name="range" value={range} />
      {range === "custom" ? <input type="hidden" name="start" value={start} /> : null}
      {range === "custom" ? <input type="hidden" name="end" value={end} /> : null}
      <input type="hidden" name="pivot" value={pivot} />
    </>
  );
  const customPreserve = (
    <>
      {customAnchor ? <input type="hidden" name="customAnchor" value="1" /> : null}
      {customAnchor ? <input type="hidden" name="customLabel" value={customLabel} /> : null}
      {customAnchor ? <input type="hidden" name="customTarget" value={customTarget} /> : null}
      {customAnchor ? <input type="hidden" name="customUnit" value={customUnit} /> : null}
    </>
  );

  if (pivot === "budget") {
    return (
      <form action="/dashboard" className="grid gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
        {common}
        <input type="hidden" name="anchorDays" value={anchorDays} />
        <input type="hidden" name="dailyCalories" value={dailyCalories} />
        {customPreserve}
        <label className="text-xs font-medium text-zinc-500" htmlFor="daily-spend-target">
          $ / day
        </label>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-500">$</span>
            <input
              id="daily-spend-target"
              name="dailySpendTarget"
              type="number"
              min={1}
              max={100000}
              step={1}
              defaultValue={dailySpendTarget}
              className="h-10 w-full rounded-md border border-zinc-200 bg-transparent px-3 pl-7 text-sm outline-none focus:border-zinc-400 dark:border-zinc-800"
            />
          </div>
          <button type="submit" className="h-10 rounded-md border border-zinc-200 px-3 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800">
            Apply
          </button>
        </div>
      </form>
    );
  }

  if (pivot === "calories") {
    return (
      <form action="/dashboard" className="grid gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
        {common}
        <input type="hidden" name="anchorDays" value={anchorDays} />
        <input type="hidden" name="dailySpendTarget" value={dailySpendTarget} />
        {customPreserve}
        <label className="text-xs font-medium text-zinc-500" htmlFor="daily-calories">
          Calories / day
        </label>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
          <input
            id="daily-calories"
            name="dailyCalories"
            type="number"
            min={1}
            max={10000}
            step={50}
            defaultValue={dailyCalories}
            className="h-10 w-full rounded-md border border-zinc-200 bg-transparent px-3 text-sm outline-none focus:border-zinc-400 dark:border-zinc-800"
          />
          <button type="submit" className="h-10 rounded-md border border-zinc-200 px-3 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800">
            Apply
          </button>
        </div>
      </form>
    );
  }

  if (pivot === "time") {
    return (
      <form action="/dashboard" className="grid gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
        {common}
        <input type="hidden" name="dailyCalories" value={dailyCalories} />
        <input type="hidden" name="dailySpendTarget" value={dailySpendTarget} />
        {customPreserve}
        <label className="text-xs font-medium text-zinc-500" htmlFor="anchor-days">
          Days / receipt
        </label>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
          <input
            id="anchor-days"
            name="anchorDays"
            type="number"
            min={1}
            max={365}
            step={1}
            defaultValue={anchorDays}
            className="h-10 w-full rounded-md border border-zinc-200 bg-transparent px-3 text-sm outline-none focus:border-zinc-400 dark:border-zinc-800"
          />
          <button type="submit" className="h-10 rounded-md border border-zinc-200 px-3 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800">
            Apply
          </button>
        </div>
      </form>
    );
  }

  return (
    <form action="/dashboard" className="grid gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
      {common}
      <input type="hidden" name="anchorDays" value={anchorDays} />
      <input type="hidden" name="dailyCalories" value={dailyCalories} />
      <input type="hidden" name="dailySpendTarget" value={dailySpendTarget} />
      <input type="hidden" name="customAnchor" value="1" />
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_90px_90px_auto]">
        <label className="sr-only" htmlFor="custom-label">Custom label</label>
        <input
          id="custom-label"
          name="customLabel"
          type="text"
          defaultValue={customLabel}
          className="h-10 w-full rounded-md border border-zinc-200 bg-transparent px-3 text-sm outline-none focus:border-zinc-400 dark:border-zinc-800"
        />
        <label className="sr-only" htmlFor="custom-target">Custom target</label>
        <input
          id="custom-target"
          name="customTarget"
          type="number"
          min={0.01}
          max={100000}
          step={0.01}
          defaultValue={customTarget}
          className="h-10 w-full rounded-md border border-zinc-200 bg-transparent px-3 text-sm outline-none focus:border-zinc-400 dark:border-zinc-800"
        />
        <label className="sr-only" htmlFor="custom-unit">Custom unit</label>
        <input
          id="custom-unit"
          name="customUnit"
          type="text"
          defaultValue={customUnit}
          className="h-10 w-full rounded-md border border-zinc-200 bg-transparent px-3 text-sm outline-none focus:border-zinc-400 dark:border-zinc-800"
        />
        <button type="submit" className="h-10 rounded-md border border-zinc-200 px-3 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800">
          Apply
        </button>
      </div>
    </form>
  );
}

function SectionHeader({
  title,
  href,
  action,
}: {
  title: string;
  href?: string;
  action?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
      <h2 className="font-semibold">{title}</h2>
      {href && action ? (
        <Link href={href} className="inline-flex items-center gap-1 text-sm font-medium text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100">
          {action}
          <ArrowRight className="size-4" />
        </Link>
      ) : null}
    </div>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{
    range?: string | string[];
    start?: string | string[];
    end?: string | string[];
    pivot?: string | string[];
    anchorDays?: string | string[];
    dailyCalories?: string | string[];
    dailySpendTarget?: string | string[];
    customAnchor?: string | string[];
    customLabel?: string | string[];
    customTarget?: string | string[];
    customUnit?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const range = parseRange(params.range);
  const customStart = parseDateParam(params.start);
  const customEnd = parseDateParam(params.end);
  const pivot = parsePivot(params.pivot);
  const anchorDays = parsePositiveNumber(params.anchorDays, 7, 1, 365);
  const dailyCalories = parsePositiveNumber(params.dailyCalories, 1500, 1, 10000);
  const dailySpendTarget = parsePositiveNumber(params.dailySpendTarget, 50, 0.01, 100000);
  const customAnchor = parseBooleanParam(params.customAnchor) || pivot === "custom";
  const customLabel = parseTextParam(params.customLabel, "Custom", 20);
  const customTarget = parsePositiveNumber(params.customTarget, 50, 0.01, 100000);
  const customUnit = parseTextParam(params.customUnit, "$/day", 16);
  const cookieStore = await cookies();
  const timeZone = timeZoneFromCookie(cookieStore.get(TIME_ZONE_COOKIE)?.value);
  const today = todayIsoInTimeZone(timeZone);
  const [rawReceipts, rawItems, ingestStatusRows, rawRecentFailures] =
    await getDashboardRows();
  const receipts: ReceiptRow[] = rawReceipts.map((receipt) => ({
    ...receipt,
    itemCount: Number(receipt.itemCount),
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
  const firstDate =
    datedReceipts.map((receipt) => receipt.resolvedDate).sort()[0] ?? today;
  const { start, end } = resolveDateRange({ range, today, firstDate, customStart, customEnd });
  const days = periodDays(start, end);
  const periodReceipts = primaryReceipts.filter((receipt) =>
    inPeriod(receipt.resolvedDate, start, end),
  );
  const intervals = buildIntervals(primaryReceipts, itemsByReceiptId, primaryReceiptIds);
  const periodIntervals = intervals.filter((interval) =>
    intervalOverlapDays(interval, start, end) > 0,
  );
  const periodSpend = periodReceipts.reduce(
    (sum, receipt) => sum + (receipt.total ?? 0),
    0,
  );
  const periodReceiptTotals = periodReceipts.map((receipt) => ({
    receipt,
    totals: receiptTotals(receipt, itemsByReceiptId.get(receipt.id) ?? []),
  }));
  const periodTotals = periodReceiptTotals.reduce((totals, row) => {
    addTotals(totals, row.totals);
    return totals;
  }, emptyTotals());
  const periodDaily = intervalDailyAverage(periodIntervals, start, end, days);
  const spendPerDay = periodSpend / days;
  const periodBudgetAllowance = dailySpendTarget * days;
  const customPeriodAllowance = customTarget * days;
  const calorieDays = dailyCalories > 0 ? periodTotals.calories / dailyCalories : 0;
  const pivotSummary =
    pivot === "time"
      ? {
          label: "Days anchor",
          value: `${formatMetric(anchorDays)} days`,
          detail: `${formatMoney(periodSpend / anchorDays)}/day if this period's receipts are stretched over ${formatMetric(anchorDays)} days.`,
        }
      : pivot === "calories"
        ? {
            label: "Calorie anchor",
            value: calorieDays > 0 ? `${formatMetric(calorieDays)} days` : "Needs nutrition",
            detail:
              periodTotals.calories > 0
                ? `${formatMetric(periodTotals.calories)} known calories at ${formatMetric(dailyCalories)} cal/day.`
                : "Add nutrition matches to estimate calorie duration.",
          }
        : pivot === "custom"
          ? {
              label: `${customLabel} anchor`,
              value: formatCustomTarget(customTarget, customUnit),
              detail: `${formatMoney(periodSpend)} spend is ${formatPercent(periodSpend / Math.max(customPeriodAllowance, 1))} of the ${customLabel} target for this ${days}-day period.`,
            }
          : {
            label: "Budget anchor",
            value: formatPercent(periodSpend / Math.max(periodBudgetAllowance, 1)),
            detail: `${formatMoney(periodSpend)} spent vs ${formatMoney(periodBudgetAllowance)} at ${formatMoney(dailySpendTarget)}/day for this ${days}-day period.`,
          };
  const pivotRows = periodReceiptTotals
    .map(({ receipt, totals }) => {
      const calories = totals.calories;
      const daysByCalories = dailyCalories > 0 && calories > 0 ? calories / dailyCalories : null;
      const budgetDays = dailySpendTarget > 0 && totals.spend > 0 ? totals.spend / dailySpendTarget : null;
      const customDays = customTarget > 0 && totals.spend > 0 ? totals.spend / customTarget : null;
      const projection =
        pivot === "time"
          ? {
              value: `${formatMoney(totals.spend / anchorDays)}/day`,
              detail: calories > 0 ? `${formatMetric(calories / anchorDays)} cal/day` : "No calories yet",
            }
          : pivot === "calories"
            ? {
                value: daysByCalories ? `${formatMetric(daysByCalories)} days` : "Needs nutrition",
                detail:
                  daysByCalories && totals.spend > 0
                    ? `${formatMoney(totals.spend / Math.max(daysByCalories, 0.1))}/day`
                    : `${formatMetric(calories)} known cal`,
              }
            : pivot === "custom"
              ? {
                  value: customDays ? `${formatMetric(customDays)} days` : "No spend",
                  detail: `${customLabel} at ${formatCustomTarget(customTarget, customUnit)}`,
                }
            : {
                value: budgetDays ? `${formatMetric(budgetDays)} target days` : "No spend",
                detail: budgetDays ? `${formatMetric(budgetDays)} budget days` : "No spend",
              };
      return { receipt, totals, projection };
    })
    .slice(0, 8);
  const knownCalories = periodTotals.calories;
  const costPerDailyCalories =
    knownCalories > 0 && periodSpend > 0 ? (periodSpend / knownCalories) * dailyCalories : null;
  const caloriesForDailySpend =
    knownCalories > 0 && periodSpend > 0 ? (knownCalories / periodSpend) * dailySpendTarget : null;
  const budgetDaysUsed = dailySpendTarget > 0 && periodSpend > 0 ? periodSpend / dailySpendTarget : null;
  const spendPerAnchorDay = anchorDays > 0 ? periodSpend / anchorDays : 0;
  const caloriesPerAnchorDay = knownCalories > 0 && anchorDays > 0 ? knownCalories / anchorDays : null;
  const customDaysUsed = customTarget > 0 && periodSpend > 0 ? periodSpend / customTarget : null;
  const totalItems = items.length;
  const datedRatio = primaryReceipts.length
    ? datedReceipts.length / primaryReceipts.length
    : 0;
  const categorizedItems = items.filter((item) => {
    const category = primaryCategory(item);
    return category && category !== "other";
  }).length;
  const categorizedRatio = totalItems ? categorizedItems / totalItems : 0;
  const nutritionItems = items.filter((item) => {
    return (
      item.nutritionStatus === "matched" ||
      item.nutritionStatus === "manual" ||
      item.calories != null ||
      item.proteinG != null ||
      item.totalGrams != null
    );
  }).length;
  const nutritionRatio = totalItems ? nutritionItems / totalItems : 0;
  const inventoryConfidence =
    primaryReceipts.length > 0
      ? datedRatio * 0.4 + categorizedRatio * 0.35 + nutritionRatio * 0.25
      : 0;
  const weeklyTrend = buildWeeklyTrend(periodReceipts, periodIntervals, start, end);
  const maxWeeklySpend = Math.max(...weeklyTrend.map((week) => week.spend), 1);
  const maxWeeklyCalories = Math.max(...weeklyTrend.map((week) => week.calories), 1);
  const repeatVendors = buildRepeatVendors(intervals, today);
  const projectedIntervals = intervals
    .filter((interval) => interval.projected && interval.endDate >= today)
    .sort((a, b) => a.endDate.localeCompare(b.endDate));
  const likelyAvailableItems = projectedIntervals
    .flatMap((interval) =>
      interval.items
        .filter((item) =>
          ["available", "pantry", "fridge"].includes(item.consumptionStatus),
        )
        .map((item) => ({ interval, item })),
    )
    .slice(0, 8);
  const duplicateReceiptIds = new Set(duplicateGroups.flatMap((group) => group.map((receipt) => receipt.id)));
  const missingDates = primaryReceipts.filter((receipt) => !receipt.resolvedDate);
  const failedReceipts = primaryReceipts.filter((receipt) => receipt.parseStatus === "failed");
  const noItemReceipts = primaryReceipts.filter((receipt) => Number(receipt.itemCount) === 0);
  const uncategorizedItems = items.filter((item) => {
    const category = primaryCategory(item);
    return !category || category === "other";
  });
  const pendingNutritionItems = items.filter((item) =>
    item.nutritionStatus === "pending" || item.nutritionStatus === "unmatched",
  );
  const recentReviewReceipts = primaryReceipts
    .filter(
      (receipt) =>
        !receipt.resolvedDate ||
        failedReceipts.some((failed) => failed.id === receipt.id) ||
        duplicateReceiptIds.has(receipt.id) ||
        Number(receipt.itemCount) === 0,
    )
    .slice(0, 8);
  const recentFailures = rawRecentFailures
    .filter((failure) => !isRateLimitError(failure.errorText))
    .slice(0, 5);
  const failedScanCount = Math.max(
    0,
    statusCount(ingestStatusRows, "failed") - statusRateLimitCount(ingestStatusRows, "failed"),
  );
  const parsedScanCount = statusCount(ingestStatusRows, "parsed");
  const skippedScanCount = statusCount(ingestStatusRows, "skipped_not_receipt");

  const pivotKpis: KpiCardModel[] =
    pivot === "calories"
      ? [
          {
            key: "pivot-cost-calories",
            label: `Cost / ${formatMetric(dailyCalories)} cal`,
            value: costPerDailyCalories == null ? "Needs nutrition" : formatMoney(costPerDailyCalories),
            detail:
              knownCalories > 0
                ? `${formatMetric(knownCalories)} known calories across ${formatMoney(periodSpend)}`
                : "Add nutrition matches to price calories.",
            icon: <Utensils className="size-4" />,
          },
          {
            key: "pivot-calorie-days",
            label: "Calorie days",
            value: calorieDays > 0 ? `${formatMetric(calorieDays)} days` : "Needs nutrition",
            detail: `${formatMetric(dailyCalories)} cal/day target`,
            icon: <CalendarDays className="size-4" />,
          },
          {
            key: "pivot-budget-buys",
            label: `${formatMoney(dailySpendTarget)}/day buys`,
            value: caloriesForDailySpend == null ? "Needs nutrition" : `${formatMetric(caloriesForDailySpend)} cal`,
            detail: "Calories estimated from this period's spend-to-calorie ratio.",
            icon: <ShoppingBasket className="size-4" />,
          },
        ]
      : pivot === "time"
        ? [
            {
              key: "pivot-cost-days",
              label: `Cost / ${formatMetric(anchorDays)} days`,
              value: formatMoney(spendPerAnchorDay),
              detail: `${formatMoney(periodSpend)} stretched over ${formatMetric(anchorDays)} days`,
              icon: <CalendarDays className="size-4" />,
            },
            {
              key: "pivot-calories-days",
              label: "Calories/day anchor",
              value: caloriesPerAnchorDay == null ? "Needs nutrition" : `${formatMetric(caloriesPerAnchorDay)} cal`,
              detail: `${formatMetric(knownCalories)} known calories over ${formatMetric(anchorDays)} days`,
              icon: <Utensils className="size-4" />,
            },
            {
              key: "pivot-budget-days",
              label: "Budget days used",
              value: budgetDaysUsed == null ? "No spend" : `${formatMetric(budgetDaysUsed)} days`,
              detail: `At ${formatMoney(dailySpendTarget)}/day`,
              icon: <ShoppingBasket className="size-4" />,
            },
          ]
        : pivot === "custom"
          ? [
              {
                key: "pivot-custom-days",
                label: `${customLabel} days`,
                value: customDaysUsed == null ? "No spend" : `${formatMetric(customDaysUsed)} days`,
                detail: `${formatMoney(periodSpend)} at ${formatCustomTarget(customTarget, customUnit)}`,
                icon: <Gauge className="size-4" />,
              },
              {
                key: "pivot-custom-share",
                label: `${customLabel} used`,
                value: formatPercent(periodSpend / Math.max(customPeriodAllowance, 1)),
                detail: `${formatMoney(periodSpend)} vs ${formatMoney(customPeriodAllowance)} in this ${days}-day period`,
                icon: <ShoppingBasket className="size-4" />,
              },
              {
                key: "pivot-custom-calories",
                label: `${customLabel} buys`,
                value:
                  knownCalories > 0 && periodSpend > 0
                    ? `${formatMetric((knownCalories / periodSpend) * customTarget)} cal`
                    : "Needs nutrition",
                detail: "Calories estimated from this period's spend-to-calorie ratio.",
                icon: <Utensils className="size-4" />,
              },
            ]
          : [
              {
                key: "pivot-budget-calories",
                label: `${formatMoney(dailySpendTarget)}/day buys`,
                value: caloriesForDailySpend == null ? "Needs nutrition" : `${formatMetric(caloriesForDailySpend)} cal`,
                detail: "Calories estimated from this period's spend-to-calorie ratio.",
                icon: <ShoppingBasket className="size-4" />,
              },
              {
                key: "pivot-budget-cost",
                label: `Cost / ${formatMetric(dailyCalories)} cal`,
                value: costPerDailyCalories == null ? "Needs nutrition" : formatMoney(costPerDailyCalories),
                detail:
                  knownCalories > 0
                    ? `${formatMetric(knownCalories)} known calories across ${formatMoney(periodSpend)}`
                    : "Add nutrition matches to price calories.",
                icon: <Utensils className="size-4" />,
              },
              {
                key: "pivot-budget-used",
                label: "Spend vs target",
                value: formatPercent(periodSpend / Math.max(periodBudgetAllowance, 1)),
                detail: `${formatMoney(periodSpend)} vs ${formatMoney(periodBudgetAllowance)} for ${days} days`,
                icon: <Gauge className="size-4" />,
              },
            ];

  const kpiCandidates: Array<KpiCardModel | null> = [
    periodSpend > 0
      ? {
          key: "spend",
          label: "Spend/day",
          value: formatMoney(spendPerDay),
          detail: `${formatMoney(periodSpend)} across ${days} days`,
          icon: <ShoppingBasket className="size-4" />,
        }
      : null,
    periodDaily.calories > 0
      ? {
          key: "calories",
          label: "Calories/day",
          value: formatMetric(periodDaily.calories),
          detail: macroLine(periodDaily) || "Estimated from repeat purchases",
          icon: <Utensils className="size-4" />,
        }
      : null,
    periodDaily.proteinG > 0
      ? {
          key: "protein",
          label: "Protein/day",
          value: `${formatMetric(periodDaily.proteinG)}g`,
          detail: macroLine(periodDaily),
          icon: <Gauge className="size-4" />,
        }
      : null,
    periodDaily.cannabisG > 0
      ? {
          key: "cannabis",
          label: "Cannabis/day",
          value: formatGrams(periodDaily.cannabisG),
          detail: activeLine(periodDaily) || "Tracked from labels",
          icon: <PackageCheck className="size-4" />,
        }
      : null,
    periodDaily.alcoholG > 0
      ? {
          key: "alcohol",
          label: "Alcohol/day",
          value: formatAlcoholOz(periodDaily.alcoholG),
          detail: "Pure alcohol equivalent",
          icon: <Wine className="size-4" />,
        }
      : null,
    periodDaily.otherControlledG > 0
      ? {
          key: "other-active",
          label: "Other active/day",
          value: formatGrams(periodDaily.otherControlledG),
          detail: otherActiveLine(periodDaily) || "Tracked active ingredients",
          icon: <Gauge className="size-4" />,
        }
      : null,
    periodDaily.caffeineMg > 0
      ? {
          key: "caffeine",
          label: "Caffeine/day",
          value: formatMg(periodDaily.caffeineMg),
          detail: "Estimated active intake",
          icon: <Coffee className="size-4" />,
        }
      : null,
    primaryReceipts.length > 0
      ? {
          key: "confidence",
          label: "Inventory confidence",
          value: percentage(inventoryConfidence),
          detail: `${percentage(datedRatio)} dated · ${percentage(categorizedRatio)} categorized`,
          icon: <Database className="size-4" />,
        }
      : null,
  ];
  const kpis = [...pivotKpis, ...kpiCandidates.filter((card): card is KpiCardModel => card !== null)];

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-zinc-500">
            <CalendarDays className="size-4" />
            {formatShortDate(start)} - {formatShortDate(end)} · {timeZone}
          </div>
          <h1 className="mt-2 text-3xl font-semibold tracking-normal">Consumption dashboard</h1>
        </div>

        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <div className="flex w-full flex-wrap rounded-lg border border-zinc-200 bg-white p-1 dark:border-zinc-800 dark:bg-zinc-900 sm:inline-flex sm:w-auto">
            {RANGE_OPTIONS.map((option) => (
              <Link
                key={option.key}
                href={dashboardHref({
                  range: option.key,
                  pivot,
                  anchorDays,
                  dailyCalories,
                  dailySpendTarget,
                  customAnchor,
                  customLabel,
                  customTarget,
                  customUnit,
                  start,
                  end,
                })}
                prefetch={false}
                className={`min-w-0 flex-1 rounded-md px-3 py-1.5 text-center text-sm font-medium sm:flex-none ${
                  range === option.key
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "text-zinc-600 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800"
                }`}
              >
                {option.label}
              </Link>
            ))}
          </div>
          <form
            action="/dashboard"
            className="grid w-full grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 sm:w-auto"
          >
            <input type="hidden" name="range" value="custom" />
            <input type="hidden" name="pivot" value={pivot} />
            <input type="hidden" name="anchorDays" value={anchorDays} />
            <input type="hidden" name="dailyCalories" value={dailyCalories} />
            <input type="hidden" name="dailySpendTarget" value={dailySpendTarget} />
            {customAnchor ? <input type="hidden" name="customAnchor" value="1" /> : null}
            {customAnchor ? <input type="hidden" name="customLabel" value={customLabel} /> : null}
            {customAnchor ? <input type="hidden" name="customTarget" value={customTarget} /> : null}
            {customAnchor ? <input type="hidden" name="customUnit" value={customUnit} /> : null}
            <label className="sr-only" htmlFor="dashboard-start">
              Start
            </label>
            <input
              id="dashboard-start"
              name="start"
              type="date"
              defaultValue={start}
              className="h-10 min-w-0 rounded-md border border-zinc-200 bg-white px-2 text-sm outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900"
            />
            <label className="sr-only" htmlFor="dashboard-end">
              End
            </label>
            <input
              id="dashboard-end"
              name="end"
              type="date"
              defaultValue={end}
              className="h-10 min-w-0 rounded-md border border-zinc-200 bg-white px-2 text-sm outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900"
            />
            <button
              type="submit"
              className="h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800"
            >
              Apply
            </button>
          </form>
          <Link
            href="/dashboard/trends"
            prefetch={false}
            className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800 sm:flex-none"
          >
            <TrendingUp className="size-4" />
            Trends
          </Link>
          <Link
            href="/"
            className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-md bg-zinc-900 px-3 text-sm font-medium text-white hover:opacity-90 dark:bg-zinc-100 dark:text-zinc-900 sm:flex-none"
          >
            <ReceiptText className="size-4" />
            Add receipt
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
          <div className={`grid gap-3 ${kpis.length >= 4 ? "md:grid-cols-2 xl:grid-cols-4" : "md:grid-cols-3"}`}>
            {kpis.map((card) => (
              <KpiCard
                key={card.key}
                label={card.label}
                value={card.value}
                detail={card.detail}
                icon={card.icon}
              />
            ))}
          </div>

          <section className="min-w-0 rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
              <div>
                <h2 className="font-semibold">Pivot view</h2>
                <p className="mt-1 text-sm text-zinc-500">
                  Choose the anchor that makes the receipt data easiest to reason about.
                </p>
              </div>
            </div>
            <div className="grid gap-4 p-4 xl:grid-cols-[minmax(280px,0.7fr)_minmax(0,1.3fr)]">
              <div className="space-y-3">
                <PivotLinks
                  range={range}
                  pivot={pivot}
                  anchorDays={anchorDays}
                  dailyCalories={dailyCalories}
                  dailySpendTarget={dailySpendTarget}
                  customAnchor={customAnchor}
                  customLabel={customLabel}
                  customTarget={customTarget}
                  customUnit={customUnit}
                  start={start}
                  end={end}
                  variant="section"
                />
                <PivotInputForm
                  range={range}
                  pivot={pivot}
                  anchorDays={anchorDays}
                  dailyCalories={dailyCalories}
                  dailySpendTarget={dailySpendTarget}
                  customAnchor={customAnchor}
                  customLabel={customLabel}
                  customTarget={customTarget}
                  customUnit={customUnit}
                  start={start}
                  end={end}
                />
                <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
                  <div className="text-xs font-medium uppercase text-zinc-500">{pivotSummary.label}</div>
                  <div className="mt-2 text-2xl font-semibold">{pivotSummary.value}</div>
                  <div className="mt-1 text-sm text-zinc-500">{pivotSummary.detail}</div>
                </div>
              </div>

              <div className="overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
                <table className="w-full min-w-[680px] text-sm">
                  <thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-500 dark:bg-zinc-800/50">
                    <tr>
                      <th className="px-3 py-2 font-medium">Receipt</th>
                      <th className="px-3 py-2 font-medium text-right">Spend</th>
                      <th className="px-3 py-2 font-medium text-right">Known calories</th>
                      <th className="px-3 py-2 font-medium text-right">Projection</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pivotRows.map((row) => (
                      <tr key={row.receipt.id} className="border-t border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/40">
                        <td className="px-3 py-2">
                          <Link href={`/receipts/${row.receipt.id}`} className="font-medium hover:underline">
                            {vendorDisplayName(row.receipt.vendor)}
                          </Link>
                          <div className="mt-0.5 text-xs text-zinc-500">{formatDate(row.receipt.resolvedDate)}</div>
                        </td>
                        <td className="px-3 py-2 text-right font-medium">{formatMoney(row.totals.spend)}</td>
                        <td className="px-3 py-2 text-right">
                          {row.totals.calories > 0 ? formatMetric(row.totals.calories) : "-"}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="font-medium">{row.projection.value}</div>
                          <div className="mt-0.5 text-xs text-zinc-500">{row.projection.detail}</div>
                        </td>
                      </tr>
                    ))}
                    {pivotRows.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-3 py-8 text-center text-sm text-zinc-500">
                          No dated receipts in this period.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(360px,0.6fr)]">
            <section className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
              <SectionHeader title="Weekly trend" href="/receipts/calendar" action="Calendar" />
              <div className="grid gap-3 p-4">
                {weeklyTrend.map((week) => (
                  <div key={week.start} className="grid gap-2 sm:grid-cols-[110px_1fr_90px] sm:items-center">
                    <div className="text-sm font-medium text-zinc-600 dark:text-zinc-400">{week.label}</div>
                    <div className="grid gap-1.5">
                      <div className="h-3 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                        <div
                          className="h-full rounded-full bg-emerald-500"
                          style={{ width: `${Math.max((week.spend / maxWeeklySpend) * 100, week.spend > 0 ? 4 : 0)}%` }}
                        />
                      </div>
                      <div className="h-3 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                        <div
                          className="h-full rounded-full bg-sky-500"
                          style={{
                            width: `${Math.max(
                              (week.calories / maxWeeklyCalories) * 100,
                              week.calories > 0 ? 4 : 0,
                            )}%`,
                          }}
                        />
                      </div>
                    </div>
                    <div className="text-right text-sm">
                      <div className="font-medium">{formatMoney(week.spend)}</div>
                      {week.calories > 0 ? (
                        <div className="text-xs text-zinc-500">{formatMetric(week.calories)} cal/day</div>
                      ) : null}
                    </div>
                  </div>
                ))}
                <div className="mt-1 flex flex-wrap gap-3 text-xs text-zinc-500">
                  <span className="inline-flex items-center gap-1">
                    <span className="size-2 rounded-full bg-emerald-500" />
                    Spend
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="size-2 rounded-full bg-sky-500" />
                    Calories/day
                  </span>
                </div>
              </div>
            </section>

            <section className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
              <SectionHeader title="Data quality" href="/email-parser" action="Parser inbox" />
              <div className="grid gap-3 p-4">
                {[
                  { label: "Missing dates", count: missingDates.length, tone: "amber" },
                  { label: "Duplicate groups", count: duplicateGroups.length, tone: "amber" },
                  { label: "Failed scans", count: failedScanCount + failedReceipts.length, tone: "red" },
                  { label: "Uncategorized items", count: uncategorizedItems.length, tone: "zinc" },
                  { label: "Nutrition pending", count: pendingNutritionItems.length, tone: "zinc" },
                  { label: "Receipts without items", count: noItemReceipts.length, tone: "zinc" },
                ]
                  .filter((item) => item.count > 0)
                  .map((item) => (
                    <div key={item.label} className="flex items-center justify-between gap-3 rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-800">
                      <div className="inline-flex items-center gap-2 text-sm">
                        <AlertTriangle
                          className={`size-4 ${
                            item.tone === "red"
                              ? "text-red-500"
                              : item.tone === "amber"
                                ? "text-amber-500"
                                : "text-zinc-400"
                          }`}
                        />
                        {item.label}
                      </div>
                      <div className="font-semibold">{item.count}</div>
                    </div>
                  ))}
                {missingDates.length === 0 &&
                duplicateGroups.length === 0 &&
                failedScanCount + failedReceipts.length === 0 &&
                uncategorizedItems.length === 0 &&
                pendingNutritionItems.length === 0 &&
                noItemReceipts.length === 0 ? (
                  <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
                    Nothing needs review right now.
                  </div>
                ) : null}
                <div className="grid grid-cols-3 gap-2 pt-1 text-center text-xs text-zinc-500">
                  <div className="rounded-md bg-zinc-50 px-2 py-2 dark:bg-zinc-950">
                    <div className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{parsedScanCount}</div>
                    Parsed
                  </div>
                  <div className="rounded-md bg-zinc-50 px-2 py-2 dark:bg-zinc-950">
                    <div className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{skippedScanCount}</div>
                    Skipped
                  </div>
                  <div className="rounded-md bg-zinc-50 px-2 py-2 dark:bg-zinc-950">
                    <div className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{failedScanCount}</div>
                    Failed
                  </div>
                </div>
              </div>
            </section>
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            <section className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
              <SectionHeader title="Repeat vendors" href="/receipts/calendar?mode=estimated" action="Calendar" />
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {repeatVendors.slice(0, 8).map((vendor) => (
                  <div key={vendor.key} className="grid gap-3 px-4 py-3 sm:grid-cols-[auto_1fr_auto] sm:items-center">
                    <VendorMark label={vendor.label} />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <Link href={`/receipts/${vendor.latest.receipt.id}`} className="font-medium hover:underline">
                          {vendor.label}
                        </Link>
                        <span className="text-xs text-zinc-500">{vendor.orders} orders</span>
                      </div>
                      <div className="mt-1 text-sm text-zinc-500">
                        every {vendor.avgDays} days · last {formatShortDate(vendor.latest.startDate)}
                      </div>
                    </div>
                    <div className="text-left sm:text-right">
                      <div className="font-medium">
                        {vendor.daysLeft > 0 ? `${vendor.daysLeft} days left` : "Due now"}
                      </div>
                      <div className="mt-1 text-xs text-zinc-500">
                        {formatMoney(vendor.latest.daily.spend)}/day
                        {vendor.latest.daily.calories > 0
                          ? ` · ${formatMetric(vendor.latest.daily.calories)} cal`
                          : ""}
                      </div>
                    </div>
                  </div>
                ))}
                {repeatVendors.length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-zinc-500">
                    Repeat patterns will appear once a vendor has multiple dated receipts.
                  </div>
                ) : null}
              </div>
            </section>

            <section className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
              <SectionHeader title="Likely available" href="/receipts/calendar" action="Calendar" />
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {likelyAvailableItems.map(({ interval, item }) => {
                  const imageUrl = imageUrlForItem(item);
                  return (
                    <div key={`${interval.id}-${item.id}`} className="grid gap-3 px-4 py-3 sm:grid-cols-[48px_1fr_auto] sm:items-center">
                      {imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={imageUrl}
                          alt=""
                          className="size-12 rounded-md border border-zinc-200 object-cover dark:border-zinc-800"
                        />
                      ) : (
                        <VendorMark text={interval.vendorLabel} />
                      )}
                      <div className="min-w-0">
                        <Link href={`/receipts/${item.receiptId}`} className="line-clamp-1 font-medium hover:underline">
                          {itemDisplayName(item)}
                        </Link>
                        <div className="mt-1 text-sm text-zinc-500">
                          {interval.vendorLabel} ·{" "}
                          {Number.isInteger(item.quantity) ? item.quantity : item.quantity.toFixed(2)} {item.unit}
                        </div>
                      </div>
                      <div className="text-left text-sm sm:text-right">
                        <div className="font-medium">until {formatShortDate(interval.endDate)}</div>
                        <div className="mt-1 text-xs text-zinc-500">{formatMoneyExact(item.price)}</div>
                      </div>
                    </div>
                  );
                })}
                {likelyAvailableItems.length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-zinc-500">
                    Projected inventory will appear after repeat purchases are dated.
                  </div>
                ) : null}
              </div>
            </section>
          </div>

          <section className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <SectionHeader title="Needs review" href="/receipts" action="All receipts" />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-zinc-50 text-left text-zinc-600 dark:bg-zinc-800/50 dark:text-zinc-400">
                  <tr>
                    <th className="px-4 py-3 font-medium">Vendor</th>
                    <th className="px-4 py-3 font-medium">Date</th>
                    <th className="px-4 py-3 font-medium text-right">Items</th>
                    <th className="px-4 py-3 font-medium text-right">Total</th>
                    <th className="px-4 py-3 font-medium">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {recentReviewReceipts.map((receipt) => {
                    const reasons = [
                      !receipt.resolvedDate ? "missing date" : null,
                      duplicateReceiptIds.has(receipt.id) ? "possible duplicate" : null,
                      receipt.parseStatus === "failed" ? "parse failed" : null,
                      Number(receipt.itemCount) === 0 ? "no items" : null,
                    ].filter(Boolean);
                    return (
                      <tr key={receipt.id} className="border-t border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/40">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <VendorMark text={vendorDisplayName(receipt.vendor)} compact />
                            <Link href={`/receipts/${receipt.id}`} className="font-medium hover:underline">
                              {vendorDisplayName(receipt.vendor)}
                            </Link>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                          {formatDate(receipt.resolvedDate)}
                        </td>
                        <td className="px-4 py-3 text-right">{receipt.itemCount}</td>
                        <td className="px-4 py-3 text-right font-medium">{formatMoneyExact(receipt.total)}</td>
                        <td className="px-4 py-3 text-zinc-500">
                          {reasons.join(", ") || (SOURCE_LABEL[receipt.source] ?? receipt.source)}
                        </td>
                      </tr>
                    );
                  })}
                  {recentReviewReceipts.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-sm text-zinc-500">
                        No receipts need review right now.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>

          {recentFailures.length > 0 ? (
            <section className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
              <SectionHeader title="Recent parser failures" href="/email-parser" action="Open parser" />
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {recentFailures.map((failure) => (
                  <div key={failure.id} className="grid gap-1 px-4 py-3 text-sm">
                    <div className="font-medium">{failure.subject ?? "No subject"}</div>
                    <div className="text-zinc-500">
                      {failure.fromAddress ?? "Unknown sender"} · {formatDate(datePart(failure.receivedAt))}
                    </div>
                    {failure.errorText ? (
                      <div className="text-xs text-red-600 dark:text-red-300">{failure.errorText}</div>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section className="grid gap-3 sm:grid-cols-3">
            <Link
              href="/receipts"
              className="rounded-lg border border-zinc-200 bg-white p-4 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800"
            >
              <ReceiptText className="size-5 text-zinc-500" />
              <div className="mt-3 font-semibold">All receipts</div>
              <div className="mt-1 text-sm text-zinc-500">{primaryReceipts.length} saved</div>
            </Link>
            <Link
              href="/receipts/calendar"
              className="rounded-lg border border-zinc-200 bg-white p-4 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800"
            >
              <TrendingUp className="size-5 text-zinc-500" />
              <div className="mt-3 font-semibold">Calendar</div>
              <div className="mt-1 text-sm text-zinc-500">Bought and estimated views</div>
            </Link>
            <Link
              href="/email-parser"
              className="rounded-lg border border-zinc-200 bg-white p-4 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800"
            >
              <Database className="size-5 text-zinc-500" />
              <div className="mt-3 font-semibold">Parser inbox</div>
              <div className="mt-1 text-sm text-zinc-500">Review scan history</div>
            </Link>
          </section>
        </>
      )}
    </div>
  );
}
