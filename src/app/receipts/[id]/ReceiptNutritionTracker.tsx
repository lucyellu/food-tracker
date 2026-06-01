"use client";

import Link from "next/link";
import {
  type CSSProperties,
  type ReactNode,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent,
  useMemo,
  useState,
} from "react";
import { CATEGORIES, CATEGORY_LABELS, type Category } from "@/lib/products/category";

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
type CalendarMode = "month" | "week" | "day";
type LogUnit = "item" | "serving" | "g" | "100g";
type ResizableLane = "receipt" | "details";
type TargetSignalMode = "goal" | "limit" | "energy";
type CustomEntryType = "caffeine" | "alcohol" | "cannabis" | "medication" | "other";

const RECEIPT_LANE_MIN = 210;
const RECEIPT_LANE_MAX = 340;
const DETAILS_LANE_MIN = 320;
const DETAILS_LANE_MAX = 520;
const LANE_NUDGE_PX = 16;

type NutritionMeta = {
  basis?: string;
  dataType?: string;
  entryType?: string;
  active?: {
    caffeineMg?: number | null;
    alcoholG?: number | null;
    thcMg?: number | null;
    cbdMg?: number | null;
    cbnMg?: number | null;
    cbgMg?: number | null;
    thcaMg?: number | null;
    cbdaMg?: number | null;
    totalThcMg?: number | null;
    totalCbdMg?: number | null;
    thcPercent?: number | null;
    cbdPercent?: number | null;
    cbnPercent?: number | null;
    cbgPercent?: number | null;
    totalThcPercent?: number | null;
    totalCbdPercent?: number | null;
    amphetamineMg?: number | null;
  };
  terpenes?: Array<{ name: string; mg?: number | null; percent?: number | null }>;
  serving?: { estimatedServings?: number | null };
  per100g?: {
    calories?: number | null;
    proteinG?: number | null;
    carbsG?: number | null;
    fatG?: number | null;
    fiberG?: number | null;
    sugarG?: number | null;
    sodiumMg?: number | null;
    alcoholG?: number | null;
    caffeineMg?: number | null;
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
  alcoholG: number | null;
  caffeineMg: number | null;
  mineralsJson: string | null;
  vitaminsJson: string | null;
  activeIngredientsJson: string | null;
};

export type ReceiptTrackerItem = {
  id: number;
  rawName: string;
  normalizedName: string | null;
  category: string | null;
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

export type ReceiptConsumptionLog = {
  id: number;
  receiptId: number;
  lineItemId: number;
  consumedAt: string;
  amount: number;
  unit: LogUnit;
  note: string | null;
};

export type ReceiptOutline = {
  id: number;
  vendor: string | null;
  purchasedAt: string | null;
  total: number | null;
  itemCount: number;
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
  alcoholG: number;
  caffeineMg: number;
  thcMg: number;
  cbdMg: number;
  cbnMg: number;
  cbgMg: number;
  amphetamineMg: number;
  potassiumMg: number;
  magnesiumMg: number;
  calciumMg: number;
  ironMg: number;
  totalGrams: number;
  servings: number;
  knownItems: number;
  itemCount: number;
};

const CATEGORY_BADGE: Record<Category, string> = {
  food: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
  drink: "border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300",
  cannabis: "border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300",
  supplement: "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
  household: "border-zinc-300 bg-zinc-100 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  personal_care: "border-pink-300 bg-pink-50 text-pink-700 dark:border-pink-900 dark:bg-pink-950/40 dark:text-pink-300",
  other: "border-zinc-300 bg-zinc-50 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400",
};

function categoryOf(item: { category: string | null }): Category {
  return (CATEGORIES as readonly string[]).includes(item.category ?? "")
    ? (item.category as Category)
    : "other";
}

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
  calories: 1433,
  fatG: 47.8,
  carbsG: 161.2,
  fiberG: 25,
  proteinG: 46,
  addedSugarG: 50,
  sodiumMg: 2300,
  potassiumMg: 2600,
  calciumMg: 1000,
  ironMg: 18,
  magnesiumMg: 320,
};

const DAILY_VALUE_BASIS = "Personal target: 110 lb, 165 cm, female, age 35";

const LOG_UNITS: LogUnit[] = ["item", "serving", "g", "100g"];
const CUSTOM_ENTRY_TYPES: CustomEntryType[] = ["caffeine", "alcohol", "cannabis", "medication", "other"];

const NUTRIENT_STICKERS = {
  calories: { emoji: "🔥", code: "cal" },
  protein: { emoji: "🥚", code: "P" },
  carbs: { emoji: "🍚", code: "C" },
  fat: { emoji: "🧈", code: "F" },
  fiber: { emoji: "🫘", code: "fiber" },
  sugar: { emoji: "🍬", code: "sugar" },
  sodium: { emoji: "🧂", code: "Na" },
  potassium: { emoji: "🍌", code: "K" },
  caffeine: { emoji: "☕", code: "caf" },
  alcohol: { emoji: "🍷", code: "alc" },
  cannabis: { emoji: "🥬", code: "THC" },
  medication: { emoji: "💊", code: "Rx" },
} as const;

type NutrientSticker = (typeof NUTRIENT_STICKERS)[keyof typeof NUTRIENT_STICKERS];

function formatMoney(n: number | null | undefined) {
  if (n == null) return "-";
  return `$${n.toFixed(2)}`;
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return "-";
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}

function formatNumber(n: number | null | undefined, digits = 0) {
  if (n == null || !Number.isFinite(n)) return "-";
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
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

function formatActiveMg(mg: number | null | undefined) {
  if (mg == null || !Number.isFinite(mg)) return "-";
  return `${formatNumber(mg, mg < 10 ? 1 : 0)}mg`;
}

function formatActiveAmount(mg: number | null | undefined, percent: number | null | undefined) {
  if (mg != null && Number.isFinite(mg)) return formatActiveMg(mg);
  if (percent != null && Number.isFinite(percent)) return `${formatNumber(percent, 2)}%`;
  return "-";
}

function formatTerpene(terpene: { name: string; mg?: number | null; percent?: number | null }) {
  if (terpene.mg != null) return `${terpene.name} ${formatActiveMg(terpene.mg)}`;
  if (terpene.percent != null) return `${terpene.name} ${formatNumber(terpene.percent, 2)}%`;
  return terpene.name;
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
  return `${formatNumber((value / dailyValue) * 100)}% target`;
}

function getTargetSignal(value: number | null | undefined, dailyValue: number, mode: TargetSignalMode = "goal") {
  if (value == null || !Number.isFinite(value) || !Number.isFinite(dailyValue) || dailyValue <= 0) {
    return {
      marker: "-",
      text: "no target",
      className: "text-zinc-500 dark:text-zinc-400",
    };
  }

  const percent = (value / dailyValue) * 100;
  const text = `${formatNumber(percent)}% target`;

  if (mode === "limit") {
    if (percent <= 100) return { marker: "→", text, className: "text-emerald-600 dark:text-emerald-400" };
    if (percent <= 125) return { marker: "↑", text, className: "text-amber-600 dark:text-amber-400" };
    return { marker: "↑↑", text, className: "text-orange-700 dark:text-orange-300" };
  }

  if (mode === "energy") {
    if (percent < 85) return { marker: "↓", text, className: "text-rose-600 dark:text-rose-400" };
    if (percent <= 115) return { marker: "→", text, className: "text-emerald-600 dark:text-emerald-400" };
    if (percent <= 135) return { marker: "↑", text, className: "text-amber-600 dark:text-amber-400" };
    return { marker: "↑↑", text, className: "text-orange-700 dark:text-orange-300" };
  }

  if (percent < 50) return { marker: "↓↓", text, className: "text-red-600 dark:text-red-400" };
  if (percent < 85) return { marker: "↓", text, className: "text-rose-600 dark:text-rose-400" };
  if (percent <= 125) return { marker: "→", text, className: "text-emerald-600 dark:text-emerald-400" };
  return { marker: "↑", text, className: "text-amber-600 dark:text-amber-400" };
}

function TargetSignal({
  value,
  dailyValue,
  mode = "goal",
}: {
  value: number | null | undefined;
  dailyValue: number;
  mode?: TargetSignalMode;
}) {
  const signal = getTargetSignal(value, dailyValue, mode);
  return (
    <span className={`inline-flex min-w-0 items-center gap-1 font-medium ${signal.className}`}>
      <span className="w-4 shrink-0 text-center font-semibold" aria-hidden="true">
        {signal.marker}
      </span>
      <span className="truncate">{signal.text}</span>
    </span>
  );
}

function addDaysToIso(iso: string, days: number) {
  const date = new Date(`${iso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function nowForDateTimeInput() {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function datePart(value: string) {
  return value.slice(0, 10);
}

function monthStartIso(iso: string) {
  return `${iso.slice(0, 7)}-01`;
}

function daysInMonth(iso: string) {
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function calendarRange(cursor: string, mode: CalendarMode) {
  if (mode === "day") return [cursor];
  if (mode === "week") return Array.from({ length: 7 }, (_, index) => addDaysToIso(cursor, index));

  const monthStart = monthStartIso(cursor);
  const leadingDays = new Date(`${monthStart}T00:00:00.000Z`).getUTCDay();
  const totalDays = Math.ceil((leadingDays + daysInMonth(cursor)) / 7) * 7;
  return Array.from({ length: totalDays }, (_, index) => addDaysToIso(monthStart, index - leadingDays));
}

function moveCalendarCursor(cursor: string, mode: CalendarMode, direction: -1 | 1) {
  if (mode === "day") return addDaysToIso(cursor, direction);
  if (mode === "week") return addDaysToIso(cursor, direction * 7);
  const date = new Date(`${monthStartIso(cursor)}T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + direction);
  return date.toISOString().slice(0, 10);
}

function calendarTitle(cursor: string, mode: CalendarMode) {
  if (mode === "month") {
    return new Date(`${monthStartIso(cursor)}T00:00:00.000Z`).toLocaleDateString(undefined, {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
  }
  if (mode === "week") return `${cursor} to ${addDaysToIso(cursor, 6)}`;
  return cursor;
}

function logUnitLabel(unit: LogUnit) {
  const labels: Record<LogUnit, string> = {
    item: "item",
    serving: "serving",
    g: "g",
    "100g": "100g",
  };
  return labels[unit];
}

function rowValues(item: ReceiptTrackerItem) {
  const meta = parseMeta(item.nutrition?.activeIngredientsJson);
  const per100gOnly = meta?.basis === "per_100g_reference_only";
  const n = item.nutrition;
  const active = meta?.active;

  return {
    meta,
    per100gOnly,
    calories: per100gOnly ? meta?.per100g?.calories : n?.calories,
    proteinG: per100gOnly ? meta?.per100g?.proteinG : n?.proteinG,
    carbsG: per100gOnly ? meta?.per100g?.carbsG : n?.carbsG,
    fatG: per100gOnly ? meta?.per100g?.fatG : n?.fatG,
    sugarG: per100gOnly ? meta?.per100g?.sugarG : n?.sugarG,
    fiberG: per100gOnly ? meta?.per100g?.fiberG : n?.fiberG,
    alcoholG: per100gOnly ? meta?.per100g?.alcoholG : (n?.alcoholG ?? meta?.active?.alcoholG),
    caffeineMg: per100gOnly ? meta?.per100g?.caffeineMg : (n?.caffeineMg ?? meta?.active?.caffeineMg),
    thcMg: active?.thcMg ?? active?.totalThcMg ?? null,
    cbdMg: active?.cbdMg ?? active?.totalCbdMg ?? null,
    cbnMg: active?.cbnMg ?? null,
    cbgMg: active?.cbgMg ?? null,
    amphetamineMg: active?.amphetamineMg ?? null,
    terpenes: meta?.terpenes ?? [],
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
    alcoholG: 0,
    caffeineMg: 0,
    thcMg: 0,
    cbdMg: 0,
    cbnMg: 0,
    cbgMg: 0,
    amphetamineMg: 0,
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
    if (!item.nutrition?.totalGrams && values.meta?.basis !== "manual_entry") return acc;
    acc.knownItems += 1;
    acc.totalGrams += item.nutrition?.totalGrams ?? 0;
    acc.calories += values.calories ?? 0;
    acc.proteinG += values.proteinG ?? 0;
    acc.carbsG += values.carbsG ?? 0;
    acc.fatG += values.fatG ?? 0;
    acc.sugarG += values.sugarG ?? 0;
    acc.fiberG += values.fiberG ?? 0;
    acc.sodiumMg += values.sodiumMg ?? 0;
    acc.alcoholG += values.alcoholG ?? 0;
    acc.caffeineMg += values.caffeineMg ?? 0;
    acc.thcMg += values.thcMg ?? 0;
    acc.cbdMg += values.cbdMg ?? 0;
    acc.cbnMg += values.cbnMg ?? 0;
    acc.cbgMg += values.cbgMg ?? 0;
    acc.amphetamineMg += values.amphetamineMg ?? 0;
    acc.potassiumMg += values.potassiumMg ?? 0;
    acc.magnesiumMg += values.magnesiumMg ?? 0;
    acc.calciumMg += values.calciumMg ?? 0;
    acc.ironMg += values.ironMg ?? 0;
    return acc;
  }, emptyTotals());
}

function computeSelectedTotals(items: ReceiptTrackerItem[]): Totals {
  return items.reduce((acc, item) => {
    const values = rowValues(item);
    const servings = values.meta?.serving?.estimatedServings ?? 0;
    acc.itemCount += 1;
    acc.price += item.price ?? 0;
    acc.servings += servings;
    if (!item.nutrition && !values.per100gOnly) return acc;
    acc.knownItems += 1;
    acc.totalGrams += item.nutrition?.totalGrams ?? (values.per100gOnly ? 100 : 0);
    acc.calories += values.calories ?? 0;
    acc.proteinG += values.proteinG ?? 0;
    acc.carbsG += values.carbsG ?? 0;
    acc.fatG += values.fatG ?? 0;
    acc.sugarG += values.sugarG ?? 0;
    acc.fiberG += values.fiberG ?? 0;
    acc.sodiumMg += values.sodiumMg ?? 0;
    acc.alcoholG += values.alcoholG ?? 0;
    acc.caffeineMg += values.caffeineMg ?? 0;
    acc.thcMg += values.thcMg ?? 0;
    acc.cbdMg += values.cbdMg ?? 0;
    acc.cbnMg += values.cbnMg ?? 0;
    acc.cbgMg += values.cbgMg ?? 0;
    acc.amphetamineMg += values.amphetamineMg ?? 0;
    acc.potassiumMg += values.potassiumMg ?? 0;
    acc.magnesiumMg += values.magnesiumMg ?? 0;
    acc.calciumMg += values.calciumMg ?? 0;
    acc.ironMg += values.ironMg ?? 0;
    return acc;
  }, emptyTotals());
}

function scaleRecord(record: Record<string, number>, divisor: number | null) {
  if (!divisor || divisor <= 0) return {};
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, value / divisor]));
}

function aggregateRecord(items: ReceiptTrackerItem[], field: "vitaminsJson" | "mineralsJson") {
  const totals: Record<string, number> = {};
  for (const item of items) {
    const record = parseJsonRecord(item.nutrition?.[field]);
    for (const [key, value] of Object.entries(record)) {
      if (!Number.isFinite(value)) continue;
      totals[key] = (totals[key] ?? 0) + value;
    }
  }
  return totals;
}

function formatMicroValue(label: string, value: number) {
  const unitMatch = label.match(/\(([^)]+)\)\s*$/);
  const unit = unitMatch?.[1] ?? "";
  const digits = Math.abs(value) < 10 ? 2 : Math.abs(value) < 100 ? 1 : 0;
  return `${formatNumber(value, digits)}${unit ? ` ${unit}` : ""}`;
}

function compactMicroLabel(label: string) {
  return label.replace(/\s*\([^)]+\)\s*$/, "").replace(/,\s*/g, ", ");
}

function microEntries(record: Record<string, number>) {
  return Object.entries(record)
    .filter(([, value]) => Number.isFinite(value) && Math.abs(value) > 0)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
}

function addScaledNutrients(
  totals: Totals,
  item: ReceiptTrackerItem,
  factor: number,
  grams: number | null,
) {
  const values = rowValues(item);
  totals.itemCount += 1;
  totals.price += (item.price ?? 0) * factor;
  if (grams != null) totals.totalGrams += grams;
  totals.knownItems += 1;
  totals.calories += (values.calories ?? 0) * factor;
  totals.proteinG += (values.proteinG ?? 0) * factor;
  totals.carbsG += (values.carbsG ?? 0) * factor;
  totals.fatG += (values.fatG ?? 0) * factor;
  totals.sugarG += (values.sugarG ?? 0) * factor;
  totals.fiberG += (values.fiberG ?? 0) * factor;
  totals.sodiumMg += (values.sodiumMg ?? 0) * factor;
  totals.alcoholG += (values.alcoholG ?? 0) * factor;
  totals.caffeineMg += (values.caffeineMg ?? 0) * factor;
  totals.thcMg += (values.thcMg ?? 0) * factor;
  totals.cbdMg += (values.cbdMg ?? 0) * factor;
  totals.cbnMg += (values.cbnMg ?? 0) * factor;
  totals.cbgMg += (values.cbgMg ?? 0) * factor;
  totals.amphetamineMg += (values.amphetamineMg ?? 0) * factor;
  totals.potassiumMg += (values.potassiumMg ?? 0) * factor;
  totals.magnesiumMg += (values.magnesiumMg ?? 0) * factor;
  totals.calciumMg += (values.calciumMg ?? 0) * factor;
  totals.ironMg += (values.ironMg ?? 0) * factor;
}

function logTotals(log: ReceiptConsumptionLog, item: ReceiptTrackerItem | undefined): Totals {
  const totals = emptyTotals();
  if (!item) return totals;

  const values = rowValues(item);
  const servings = values.meta?.serving?.estimatedServings ?? null;
  if (log.unit === "g" || log.unit === "100g") {
    const grams = log.unit === "g" ? log.amount : log.amount * 100;
    const factor = item.nutrition?.totalGrams ? grams / item.nutrition.totalGrams : grams / 100;
    addScaledNutrients(totals, item, factor, grams);
    return totals;
  }

  const grams = item.nutrition?.totalGrams ?? null;
  const factor =
    log.unit === "serving"
      ? servings && servings > 0
        ? log.amount / servings
        : null
      : item.quantity > 0
        ? log.amount / item.quantity
        : log.amount;
  if (factor == null) return totals;
  addScaledNutrients(totals, item, factor, grams == null ? null : grams * factor);
  totals.servings += log.unit === "serving" ? log.amount : servings ? servings * factor : 0;
  return totals;
}

function computeLogTotals(logs: ReceiptConsumptionLog[], itemsById: Map<number, ReceiptTrackerItem>) {
  return logs.reduce((acc, log) => {
    const totals = logTotals(log, itemsById.get(log.lineItemId));
    acc.price += totals.price;
    acc.calories += totals.calories;
    acc.proteinG += totals.proteinG;
    acc.carbsG += totals.carbsG;
    acc.fatG += totals.fatG;
    acc.sugarG += totals.sugarG;
    acc.fiberG += totals.fiberG;
    acc.sodiumMg += totals.sodiumMg;
    acc.alcoholG += totals.alcoholG;
    acc.caffeineMg += totals.caffeineMg;
    acc.thcMg += totals.thcMg;
    acc.cbdMg += totals.cbdMg;
    acc.cbnMg += totals.cbnMg;
    acc.cbgMg += totals.cbgMg;
    acc.amphetamineMg += totals.amphetamineMg;
    acc.potassiumMg += totals.potassiumMg;
    acc.magnesiumMg += totals.magnesiumMg;
    acc.calciumMg += totals.calciumMg;
    acc.ironMg += totals.ironMg;
    acc.totalGrams += totals.totalGrams;
    acc.servings += totals.servings;
    acc.knownItems += totals.knownItems;
    acc.itemCount += 1;
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
    alcoholG: totals.alcoholG / divisor,
    caffeineMg: totals.caffeineMg / divisor,
    thcMg: totals.thcMg / divisor,
    cbdMg: totals.cbdMg / divisor,
    cbnMg: totals.cbnMg / divisor,
    cbgMg: totals.cbgMg / divisor,
    amphetamineMg: totals.amphetamineMg / divisor,
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

function NutrientEmojiBadge({ sticker }: { sticker: NutrientSticker }) {
  return (
    <span
      aria-label={sticker.code}
      className="grid h-8 w-8 shrink-0 place-items-center text-2xl leading-none drop-shadow-sm"
      role="img"
      title={sticker.code}
    >
      {sticker.emoji}
    </span>
  );
}

function SummaryCard({
  label,
  value,
  sub,
  sticker,
}: {
  label: string;
  value: string;
  sub?: ReactNode;
  sticker?: NutrientSticker;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs text-zinc-500">{label}</div>
          <div className="mt-1 text-xl font-semibold">{value}</div>
        </div>
        {sticker ? <NutrientEmojiBadge sticker={sticker} /> : null}
      </div>
      {sub ? <div className="mt-1 min-w-0 text-xs text-zinc-500">{sub}</div> : null}
    </div>
  );
}

type MetricCardConfig = {
  key: string;
  label: string;
  value: number | null | undefined;
  unit: string;
  dv?: number;
  digits?: number;
  signalMode?: TargetSignalMode;
  sticker?: NutrientSticker;
  sub?: ReactNode;
};

function hasMetricValue(value: number | null | undefined) {
  return value != null && Number.isFinite(value) && Math.abs(value) > 0.0001;
}

function MetricCard({ card }: { card: MetricCardConfig }) {
  const display = card.value == null ? "-" : `${formatNumber(card.value, card.digits ?? 0)}${card.unit}`;
  return (
    <SummaryCard
      label={card.label}
      value={display}
      sticker={card.sticker}
      sub={
        card.sub ??
        (card.dv ? <TargetSignal value={card.value} dailyValue={card.dv} mode={card.signalMode ?? "goal"} /> : undefined)
      }
    />
  );
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
  initialLogs,
  receiptOutline,
  purchasedAt,
  initialDays = 7,
  windowNote = null,
}: {
  receiptId: number;
  initialItems: ReceiptTrackerItem[];
  initialLogs: ReceiptConsumptionLog[];
  receiptOutline: ReceiptOutline[];
  purchasedAt: string | null;
  initialDays?: number;
  windowNote?: string | null;
}) {
  const startDate = purchasedAt && /^\d{4}-\d{2}-\d{2}$/.test(purchasedAt) ? purchasedAt : todayIso();
  const [items, setItems] = useState(initialItems);
  const [logs, setLogs] = useState(initialLogs);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [people, setPeople] = useState(2);
  const [days, setDays] = useState(Math.max(initialDays, 1));
  const [view, setView] = useState<ViewMode>("table");
  const [selectedRate, setSelectedRate] = useState<RateMode>("total");
  const [statusDate, setStatusDate] = useState(startDate);
  const [calendarMode, setCalendarMode] = useState<CalendarMode>("month");
  const [calendarCursor, setCalendarCursor] = useState(monthStartIso(startDate));
  const [logAmount, setLogAmount] = useState(1);
  const [logUnit, setLogUnit] = useState<LogUnit>("item");
  const [logAt, setLogAt] = useState(nowForDateTimeInput());
  const [logNote, setLogNote] = useState("");
  const [customType, setCustomType] = useState<CustomEntryType>("caffeine");
  const [customName, setCustomName] = useState("Coffee / tea");
  const [customCaffeineMg, setCustomCaffeineMg] = useState(95);
  const [customAlcoholG, setCustomAlcoholG] = useState(0);
  const [customThcMg, setCustomThcMg] = useState(0);
  const [customCbdMg, setCustomCbdMg] = useState(0);
  const [customCbnMg, setCustomCbnMg] = useState(0);
  const [customCbgMg, setCustomCbgMg] = useState(0);
  const [customAmphetamineMg, setCustomAmphetamineMg] = useState(0);
  const [outlineWidth, setOutlineWidth] = useState(250);
  const [detailsWidth, setDetailsWidth] = useState(370);
  const [outlineCollapsed, setOutlineCollapsed] = useState(false);
  const [detailsCollapsed, setDetailsCollapsed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [itemEdit, setItemEdit] = useState({ rawName: "", quantity: "1", price: "", category: "other" as Category });
  const [itemEditForId, setItemEditForId] = useState<number | undefined>(undefined);

  const planEnd = addDaysToIso(startDate, Math.max(days, 1));
  const trackedItems = useMemo(() => items.filter(isTrackedForPlan), [items]);
  const selectedItems = useMemo(
    () => items.filter((item) => selectedIds.has(item.id)),
    [items, selectedIds],
  );
  const selectedPrimaryItem = selectedItems[0];
  // Reseed the edit form when the selected row changes (render-time adjustment,
  // the React-recommended alternative to a setState-in-effect).
  if (selectedPrimaryItem && selectedPrimaryItem.id !== itemEditForId) {
    setItemEditForId(selectedPrimaryItem.id);
    setItemEdit({
      rawName: selectedPrimaryItem.rawName,
      quantity: String(selectedPrimaryItem.quantity ?? 1),
      price: selectedPrimaryItem.price == null ? "" : String(selectedPrimaryItem.price),
      category: categoryOf(selectedPrimaryItem),
    });
  }
  const selectedPrimaryLogs = useMemo(
    () =>
      selectedPrimaryItem
        ? logs.filter((log) => log.lineItemId === selectedPrimaryItem.id).sort((a, b) => b.consumedAt.localeCompare(a.consumedAt))
        : [],
    [logs, selectedPrimaryItem],
  );
  const itemsById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const visibleItems = useMemo(() => {
    if (view === "pantry") return items.filter(isPantryStatus);
    if (view === "consumed") {
      const loggedItemIds = new Set(logs.map((log) => log.lineItemId));
      return items.filter((item) => item.consumptionStatus === "consumed" || loggedItemIds.has(item.id));
    }
    return items;
  }, [items, logs, view]);
  const trackedTotals = useMemo(() => computeTotals(trackedItems), [trackedItems]);
  const dailyPersonTotals = useMemo(
    () => scaleTotals(trackedTotals, Math.max(people, 1) * Math.max(days, 1)),
    [trackedTotals, people, days],
  );
  const selectedTotals = useMemo(() => computeSelectedTotals(selectedItems), [selectedItems]);
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
  const calendarDays = useMemo(() => calendarRange(calendarCursor, calendarMode), [calendarCursor, calendarMode]);
  const consumedTotals = useMemo(() => computeLogTotals(logs, itemsById), [logs, itemsById]);
  const visibleIds = useMemo(() => visibleItems.map((item) => item.id), [visibleItems]);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const unknownNutritionRows = allTotals.itemCount - allTotals.knownItems - statusCounts.refunded;
  const selectedDenominator = rateDivisor(selectedRate, selectedTotals, people, days);
  const microSummaryItems = selectedItems.length > 0 ? selectedItems : visibleItems;
  const microSummaryLabel = selectedItems.length > 0 ? "selected rows" : "visible rows";
  const microDivisor = selectedItems.length > 0 ? selectedDenominator : 1;
  const selectedVitamins = useMemo(
    () => scaleRecord(aggregateRecord(microSummaryItems, "vitaminsJson"), microDivisor),
    [microSummaryItems, microDivisor],
  );
  const selectedMinerals = useMemo(
    () => scaleRecord(aggregateRecord(microSummaryItems, "mineralsJson"), microDivisor),
    [microSummaryItems, microDivisor],
  );
  const vitaminEntries = useMemo(() => microEntries(selectedVitamins), [selectedVitamins]);
  const mineralEntries = useMemo(() => microEntries(selectedMinerals), [selectedMinerals]);
  const dailyMetricCards = useMemo<MetricCardConfig[]>(
    () =>
      [
        {
          key: "calories",
          label: "Daily calories / person",
          value: dailyPersonTotals.calories,
          unit: "",
          dv: DAILY_VALUES.calories,
          signalMode: "energy" as const,
          sticker: NUTRIENT_STICKERS.calories,
        },
        {
          key: "protein",
          label: "Daily protein / person",
          value: dailyPersonTotals.proteinG,
          unit: "g",
          dv: DAILY_VALUES.proteinG,
          sticker: NUTRIENT_STICKERS.protein,
        },
        {
          key: "carbs",
          label: "Daily carbs / person",
          value: dailyPersonTotals.carbsG,
          unit: "g",
          dv: DAILY_VALUES.carbsG,
          sticker: NUTRIENT_STICKERS.carbs,
        },
        {
          key: "fat",
          label: "Daily fat / person",
          value: dailyPersonTotals.fatG,
          unit: "g",
          dv: DAILY_VALUES.fatG,
          signalMode: "limit" as const,
          sticker: NUTRIENT_STICKERS.fat,
        },
        {
          key: "sodium",
          label: "Daily sodium / person",
          value: dailyPersonTotals.sodiumMg,
          unit: "mg",
          dv: DAILY_VALUES.sodiumMg,
          signalMode: "limit" as const,
          sticker: NUTRIENT_STICKERS.sodium,
        },
        {
          key: "potassium",
          label: "Daily potassium / person",
          value: dailyPersonTotals.potassiumMg,
          unit: "mg",
          dv: DAILY_VALUES.potassiumMg,
          sticker: NUTRIENT_STICKERS.potassium,
        },
        {
          key: "caffeine",
          label: "Daily caffeine / person",
          value: dailyPersonTotals.caffeineMg,
          unit: "mg",
          sticker: NUTRIENT_STICKERS.caffeine,
        },
        {
          key: "alcohol",
          label: "Daily alcohol / person",
          value: dailyPersonTotals.alcoholG,
          unit: "g",
          digits: 1,
          sticker: NUTRIENT_STICKERS.alcohol,
        },
        {
          key: "thc",
          label: "Daily THC / person",
          value: dailyPersonTotals.thcMg,
          unit: "mg",
          digits: 1,
          sticker: NUTRIENT_STICKERS.cannabis,
        },
        {
          key: "cbd",
          label: "Daily CBD / person",
          value: dailyPersonTotals.cbdMg,
          unit: "mg",
          digits: 1,
          sticker: NUTRIENT_STICKERS.cannabis,
        },
        {
          key: "cbn",
          label: "Daily CBN / person",
          value: dailyPersonTotals.cbnMg,
          unit: "mg",
          digits: 1,
          sticker: NUTRIENT_STICKERS.cannabis,
        },
        {
          key: "cbg",
          label: "Daily CBG / person",
          value: dailyPersonTotals.cbgMg,
          unit: "mg",
          digits: 1,
          sticker: NUTRIENT_STICKERS.cannabis,
        },
        {
          key: "amphetamine",
          label: "Daily medication / person",
          value: dailyPersonTotals.amphetamineMg,
          unit: "mg",
          sticker: NUTRIENT_STICKERS.medication,
        },
      ].filter((card) => hasMetricValue(card.value)),
    [dailyPersonTotals],
  );
  const selectedMetricCards = useMemo<MetricCardConfig[]>(
    () =>
      [
        {
          key: "calories",
          label: "Calories",
          value: selectedScaledTotals.calories,
          unit: "",
          dv: DAILY_VALUES.calories,
          signalMode: "energy" as const,
          sticker: NUTRIENT_STICKERS.calories,
        },
        {
          key: "protein",
          label: "Protein",
          value: selectedScaledTotals.proteinG,
          unit: "g",
          dv: DAILY_VALUES.proteinG,
          sticker: NUTRIENT_STICKERS.protein,
        },
        {
          key: "carbs",
          label: "Carbs",
          value: selectedScaledTotals.carbsG,
          unit: "g",
          dv: DAILY_VALUES.carbsG,
          sticker: NUTRIENT_STICKERS.carbs,
        },
        {
          key: "fat",
          label: "Fat",
          value: selectedScaledTotals.fatG,
          unit: "g",
          dv: DAILY_VALUES.fatG,
          signalMode: "limit" as const,
          sticker: NUTRIENT_STICKERS.fat,
        },
        {
          key: "fiber",
          label: "Fiber",
          value: selectedScaledTotals.fiberG,
          unit: "g",
          dv: DAILY_VALUES.fiberG,
          sticker: NUTRIENT_STICKERS.fiber,
        },
        {
          key: "sugar",
          label: "Sugar",
          value: selectedScaledTotals.sugarG,
          unit: "g",
          sticker: NUTRIENT_STICKERS.sugar,
          sub: "Total sugar has no personal target",
        },
        {
          key: "salt",
          label: "Salt",
          value: sodiumToSaltG(selectedScaledTotals.sodiumMg),
          unit: "g",
          digits: 1,
          sticker: NUTRIENT_STICKERS.sodium,
          sub: <TargetSignal value={selectedScaledTotals.sodiumMg} dailyValue={DAILY_VALUES.sodiumMg} mode="limit" />,
        },
        {
          key: "potassium",
          label: "Potassium",
          value: selectedScaledTotals.potassiumMg,
          unit: "mg",
          dv: DAILY_VALUES.potassiumMg,
          sticker: NUTRIENT_STICKERS.potassium,
        },
        {
          key: "calcium",
          label: "Calcium",
          value: selectedScaledTotals.calciumMg,
          unit: "mg",
          dv: DAILY_VALUES.calciumMg,
        },
        {
          key: "caffeine",
          label: "Caffeine",
          value: selectedScaledTotals.caffeineMg,
          unit: "mg",
          sticker: NUTRIENT_STICKERS.caffeine,
        },
        {
          key: "alcohol",
          label: "Alcohol",
          value: selectedScaledTotals.alcoholG,
          unit: "g",
          digits: 1,
          sticker: NUTRIENT_STICKERS.alcohol,
        },
        {
          key: "thc",
          label: "THC",
          value: selectedScaledTotals.thcMg,
          unit: "mg",
          digits: 1,
          sticker: NUTRIENT_STICKERS.cannabis,
        },
        {
          key: "cbd",
          label: "CBD",
          value: selectedScaledTotals.cbdMg,
          unit: "mg",
          digits: 1,
          sticker: NUTRIENT_STICKERS.cannabis,
        },
        {
          key: "cbn",
          label: "CBN",
          value: selectedScaledTotals.cbnMg,
          unit: "mg",
          digits: 1,
          sticker: NUTRIENT_STICKERS.cannabis,
        },
        {
          key: "cbg",
          label: "CBG",
          value: selectedScaledTotals.cbgMg,
          unit: "mg",
          digits: 1,
          sticker: NUTRIENT_STICKERS.cannabis,
        },
        {
          key: "amphetamine",
          label: "Medication",
          value: selectedScaledTotals.amphetamineMg,
          unit: "mg",
          sticker: NUTRIENT_STICKERS.medication,
        },
      ].filter((card) => hasMetricValue(card.value)),
    [selectedScaledTotals],
  );
  const laneStyle = {
    "--receipt-lane": outlineCollapsed ? "52px" : `${outlineWidth}px`,
    "--details-lane": detailsCollapsed ? "52px" : `${detailsWidth}px`,
  } as CSSProperties;

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

  async function logConsumption() {
    if (!selectedPrimaryItem) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/receipts/${receiptId}/consumption`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          lineItemId: selectedPrimaryItem.id,
          consumedAt: logAt,
          amount: logAmount,
          unit: logUnit,
          note: logNote,
        }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { log: ReceiptConsumptionLog };
      setLogs((current) => [...current, data.log].sort((a, b) => a.consumedAt.localeCompare(b.consumedAt)));
      setLogNote("");
    } finally {
      setSaving(false);
    }
  }

  async function addCustomEntry() {
    const trimmedName = customName.trim();
    if (!trimmedName) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/receipts/${receiptId}/items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: trimmedName,
          entryType: customType,
          consumedAt: logAt,
          caffeineMg: customCaffeineMg,
          alcoholG: customAlcoholG,
          thcMg: customThcMg,
          cbdMg: customCbdMg,
          cbnMg: customCbnMg,
          cbgMg: customCbgMg,
          amphetamineMg: customAmphetamineMg,
          note: logNote,
        }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        item: ReceiptTrackerItem;
        log: ReceiptConsumptionLog;
      };
      setItems((current) => [...current, data.item]);
      setLogs((current) => [...current, data.log].sort((a, b) => a.consumedAt.localeCompare(b.consumedAt)));
      setSelectedIds(new Set([data.item.id]));
      setLogNote("");
    } finally {
      setSaving(false);
    }
  }

  async function deleteLog(logId: number) {
    setSaving(true);
    const previous = logs;
    setLogs((current) => current.filter((log) => log.id !== logId));
    try {
      const res = await fetch(`/api/receipts/${receiptId}/consumption`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ logId }),
      });
      if (!res.ok) setLogs(previous);
    } finally {
      setSaving(false);
    }
  }

  async function saveItemEdits() {
    if (!selectedPrimaryItem) return;
    const id = selectedPrimaryItem.id;
    const rawName = itemEdit.rawName.trim();
    if (!rawName) return;
    const quantity = Math.max(Number(itemEdit.quantity) || 1, 0.0001);
    const price = itemEdit.price.trim() === "" ? null : Number(itemEdit.price);
    if (price != null && (!Number.isFinite(price) || price < 0)) return;
    const category = itemEdit.category;

    setSaving(true);
    const previous = items;
    setItems((current) =>
      current.map((item) =>
        item.id === id ? { ...item, rawName, quantity, price, category } : item,
      ),
    );
    try {
      const res = await fetch(`/api/receipts/${receiptId}/items/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rawName, quantity, price, category }),
      });
      if (!res.ok) setItems(previous);
    } finally {
      setSaving(false);
    }
  }

  async function setItemCategory(id: number, category: Category) {
    setSaving(true);
    const previous = items;
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, category } : item)),
    );
    try {
      const res = await fetch(`/api/receipts/${receiptId}/items/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ category }),
      });
      if (!res.ok) setItems(previous);
    } finally {
      setSaving(false);
    }
  }

  async function deleteItem(id: number) {
    if (!confirm("Delete this line item? This cannot be undone.")) return;
    setSaving(true);
    const previousItems = items;
    const previousLogs = logs;
    setItems((current) => current.filter((item) => item.id !== id));
    setLogs((current) => current.filter((log) => log.lineItemId !== id));
    setSelectedIds((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    try {
      const res = await fetch(`/api/receipts/${receiptId}/items/${id}`, { method: "DELETE" });
      if (!res.ok) {
        setItems(previousItems);
        setLogs(previousLogs);
      }
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

  function resizeLane(lane: ResizableLane, nextWidth: number) {
    if (lane === "receipt") {
      setOutlineCollapsed(false);
      setOutlineWidth(clampNumber(nextWidth, RECEIPT_LANE_MIN, RECEIPT_LANE_MAX));
      return;
    }

    setDetailsCollapsed(false);
    setDetailsWidth(clampNumber(nextWidth, DETAILS_LANE_MIN, DETAILS_LANE_MAX));
  }

  function startLaneResize(event: ReactPointerEvent<HTMLDivElement>, lane: ResizableLane) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth =
      lane === "receipt"
        ? outlineCollapsed
          ? RECEIPT_LANE_MIN
          : outlineWidth
        : detailsCollapsed
          ? DETAILS_LANE_MIN
          : detailsWidth;

    if (lane === "receipt") setOutlineCollapsed(false);
    else setDetailsCollapsed(false);

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const delta = lane === "receipt" ? moveEvent.clientX - startX : startX - moveEvent.clientX;
      resizeLane(lane, startWidth + delta);
    };

    const stopResize = () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
  }

  function nudgeLane(event: KeyboardEvent<HTMLDivElement>, lane: ResizableLane) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    if (lane === "receipt") {
      resizeLane("receipt", outlineWidth + direction * LANE_NUDGE_PX);
      return;
    }

    resizeLane("details", detailsWidth - direction * LANE_NUDGE_PX);
  }

  function rowClickSelect(event: MouseEvent<HTMLTableRowElement>, id: number) {
    const target = event.target as HTMLElement;
    if (target.closest("a,button,input,select,textarea,label")) return;
    toggleSelected(id);
  }

  function renderItemsTable(tableItems: ReceiptTrackerItem[]) {
    const tableTotals = computeTotals(tableItems);

    return (
      <div className="h-[72vh] overflow-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full text-xs leading-tight">
          <thead className="sticky top-0 z-10 bg-zinc-50 text-left text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
            <tr>
              <th className="w-8 px-2 py-2 font-medium">
                <input
                  type="checkbox"
                  aria-label="Select visible items"
                  checked={allVisibleSelected}
                  onChange={(e) => (e.target.checked ? selectAllVisible() : clearSelection())}
                  className="h-3.5 w-3.5"
                />
              </th>
              <th className="px-2 py-2 font-medium">Item</th>
              <th className="px-2 py-2 font-medium">Tag</th>
              <th className="px-2 py-2 font-medium">Amount</th>
              <th className="px-2 py-2 text-right font-medium">Price</th>
              <th className="px-2 py-2 text-right font-medium">Calories</th>
              <th className="px-2 py-2 font-medium">Macros</th>
              <th className="px-2 py-2 font-medium">Sugar & fiber</th>
              <th className="px-2 py-2 font-medium">Electrolytes</th>
              <th className="px-2 py-2 font-medium">Actives</th>
              <th className="px-2 py-2 font-medium">Source</th>
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
                  tabIndex={0}
                  onClick={(event) => rowClickSelect(event, item.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      toggleSelected(item.id);
                    }
                  }}
                  className={`cursor-pointer border-t border-zinc-100 transition-colors hover:bg-zinc-100/80 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-zinc-900 dark:border-zinc-800 dark:hover:bg-zinc-800/70 dark:focus:ring-zinc-100 ${STATUS_META[item.consumptionStatus].className} ${
                    selected ? "outline outline-2 outline-zinc-900 dark:outline-zinc-100" : ""
                  }`}
                >
                  <td className="px-2 py-1.5 align-top">
                    <input
                      type="checkbox"
                      aria-label={`Select ${item.rawName}`}
                      checked={selected}
                      onChange={() => toggleSelected(item.id)}
                      className="h-3.5 w-3.5"
                    />
                  </td>
                  <td className="px-2 py-1.5 align-top font-medium">
                    <div className="flex min-w-56 items-start gap-2">
                      {item.productImageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.productImageUrl}
                          alt=""
                          className="h-9 w-9 rounded border border-zinc-200 bg-zinc-50 object-cover dark:border-zinc-800 dark:bg-zinc-950"
                          loading="lazy"
                        />
                      ) : (
                        <div className="h-9 w-9 rounded border border-dashed border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950" />
                      )}
                      <div className="min-w-0">
                        <div className="max-w-64 truncate">{item.rawName}</div>
                        {item.normalizedName ? (
                          <div className="mt-0.5 max-w-64 truncate text-[11px] text-zinc-500">{item.normalizedName}</div>
                        ) : null}
                        <select
                          value={categoryOf(item)}
                          disabled={saving}
                          aria-label={`Category for ${item.rawName}`}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => setItemCategory(item.id, e.target.value as Category)}
                          className={`mt-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${CATEGORY_BADGE[categoryOf(item)]}`}
                        >
                          {CATEGORIES.map((cat) => (
                            <option key={cat} value={cat}>
                              {CATEGORY_LABELS[cat]}
                            </option>
                          ))}
                        </select>
                        <div className="mt-0.5 max-w-64 truncate text-[11px] text-zinc-500">
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
                  <td className="px-2 py-1.5 align-top">
                    <select
                      value={item.consumptionStatus}
                      disabled={saving}
                      onChange={(e) => setStatus([item.id], e.target.value as ConsumptionStatus, item.statusDate ?? statusDate)}
                      className="w-28 rounded border border-zinc-200 bg-transparent px-1.5 py-0.5 text-[11px] dark:border-zinc-800"
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
                        className="mt-1 w-28 rounded border border-zinc-200 bg-transparent px-1.5 py-0.5 text-[11px] dark:border-zinc-800"
                      />
                    ) : null}
                  </td>
                  <td className="px-2 py-1.5 align-top text-[11px] text-zinc-600 dark:text-zinc-400">
                    <div>{formatNormalizedAmount(item.rawName, item.unit, item.nutrition?.totalGrams)}</div>
                    <div className="mt-0.5 text-zinc-500">
                      {formatNumber(item.quantity, 2)} {item.unit}
                    </div>
                    {serving?.estimatedServings ? (
                      <div className="mt-0.5 text-zinc-500">
                        {formatNumber(serving.estimatedServings, 1)} servings
                      </div>
                    ) : null}
                  </td>
                  <td className="px-2 py-1.5 text-right align-top">{formatMoney(item.price)}</td>
                  <td className="px-2 py-1.5 text-right align-top">
                    {formatNumber(values.calories)}
                    {values.per100gOnly && values.calories != null ? (
                      <span className="text-[11px] text-zinc-500"> /100g</span>
                    ) : null}
                    <div className="mt-0.5 text-[11px] text-zinc-500">
                      {percentDv(values.calories, DAILY_VALUES.calories)}
                    </div>
                  </td>
                  <td className="px-2 py-1.5 align-top text-[11px] text-zinc-600 dark:text-zinc-400">
                    P {formatNumber(values.proteinG, 1)}g ({percentDv(values.proteinG, DAILY_VALUES.proteinG)})
                    <div className="mt-0.5">
                      C {formatNumber(values.carbsG, 1)}g ({percentDv(values.carbsG, DAILY_VALUES.carbsG)})
                    </div>
                    <div className="mt-0.5">
                      F {formatNumber(values.fatG, 1)}g ({percentDv(values.fatG, DAILY_VALUES.fatG)})
                    </div>
                  </td>
                  <td className="px-2 py-1.5 align-top text-[11px] text-zinc-600 dark:text-zinc-400">
                    Sugar {formatNumber(values.sugarG, 1)}g
                    <div className="mt-0.5 text-zinc-500">
                      Fiber {formatNumber(values.fiberG, 1)}g ({percentDv(values.fiberG, DAILY_VALUES.fiberG)})
                    </div>
                    <div className="mt-0.5 text-zinc-500">No sugar % target</div>
                  </td>
                  <td className="px-2 py-1.5 align-top text-[11px] text-zinc-600 dark:text-zinc-400">
                    Na {formatMg(values.sodiumMg)} ({percentDv(values.sodiumMg, DAILY_VALUES.sodiumMg)})
                    <div className="mt-0.5 text-zinc-500">
                      Salt {formatNumber(sodiumToSaltG(values.sodiumMg), 2)}g · K {formatMg(values.potassiumMg)} (
                      {percentDv(values.potassiumMg, DAILY_VALUES.potassiumMg)})
                    </div>
                    <div className="mt-0.5 text-zinc-500">
                      Mg {formatMg(values.magnesiumMg)} ({percentDv(values.magnesiumMg, DAILY_VALUES.magnesiumMg)}) ·
                      Ca {formatMg(values.calciumMg)} ({percentDv(values.calciumMg, DAILY_VALUES.calciumMg)})
                    </div>
                  </td>
                  <td className="px-2 py-1.5 align-top text-[11px] text-zinc-600 dark:text-zinc-400">
                    Caff {formatMg(values.caffeineMg)}
                    <div className="mt-0.5 text-zinc-500">Alc {formatNumber(values.alcoholG, 1)}g</div>
                    <div className="mt-0.5 text-zinc-500">
                      THC {formatActiveAmount(values.thcMg, values.meta?.active?.thcPercent ?? values.meta?.active?.totalThcPercent)} · CBD{" "}
                      {formatActiveAmount(values.cbdMg, values.meta?.active?.cbdPercent ?? values.meta?.active?.totalCbdPercent)}
                    </div>
                    <div className="mt-0.5 text-zinc-500">
                      CBN {formatActiveAmount(values.cbnMg, values.meta?.active?.cbnPercent)} · CBG{" "}
                      {formatActiveAmount(values.cbgMg, values.meta?.active?.cbgPercent)}
                    </div>
                    {values.terpenes.length > 0 ? (
                      <div className="mt-0.5 max-w-32 truncate text-zinc-500">
                        {values.terpenes.slice(0, 2).map(formatTerpene).join(" · ")}
                      </div>
                    ) : null}
                    <div className="mt-0.5 text-zinc-500">Rx {formatMg(values.amphetamineMg)}</div>
                  </td>
                  <td className="px-2 py-1.5 align-top text-[11px]">
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
                    {values.meta?.dataType ? <div className="mt-0.5 text-zinc-500">{values.meta.dataType}</div> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="sticky bottom-0 z-10 bg-zinc-50 text-xs shadow-[0_-1px_0_rgba(0,0,0,0.08)] dark:bg-zinc-800">
            <tr>
              <td className="px-2 py-2"></td>
              <td className="px-2 py-2 font-medium">All visible total</td>
              <td className="px-2 py-2">{tableItems.length} rows</td>
              <td className="px-2 py-2">{tableTotals.knownItems} nutrition totals</td>
              <td className="px-2 py-2 text-right font-medium">{formatMoney(tableTotals.price)}</td>
              <td className="px-2 py-2 text-right font-medium">{formatNumber(tableTotals.calories)}</td>
              <td className="px-2 py-2">
                P {formatNumber(tableTotals.proteinG)}g · C {formatNumber(tableTotals.carbsG)}g · F{" "}
                {formatNumber(tableTotals.fatG)}g
              </td>
              <td className="px-2 py-2">
                Sugar {formatNumber(tableTotals.sugarG)}g · Fiber {formatNumber(tableTotals.fiberG)}g
              </td>
              <td className="px-2 py-2">
                Salt {formatNumber(sodiumToSaltG(tableTotals.sodiumMg), 1)}g · K{" "}
                {formatMg(tableTotals.potassiumMg)}
              </td>
              <td className="px-2 py-2">
                Caff {formatMg(tableTotals.caffeineMg)} · Alc {formatNumber(tableTotals.alcoholG, 1)}g · THC{" "}
                {formatActiveMg(tableTotals.thcMg)} · CBD {formatActiveMg(tableTotals.cbdMg)}
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
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-10">
        <SummaryCard
          label="Tracked rows"
          value={`${trackedTotals.itemCount}`}
          sub={`${trackedTotals.knownItems} with nutrition totals`}
        />
        <SummaryCard label="Plan range" value={`${startDate}`} sub={`to ${planEnd}`} />
        {dailyMetricCards.map((card) => (
          <MetricCard key={card.key} card={card} />
        ))}
      </div>
      <div className="mt-2 text-xs text-zinc-500">
        Signals: <span className="font-medium text-red-600 dark:text-red-400">↓↓ low</span>,{" "}
        <span className="font-medium text-emerald-600 dark:text-emerald-400">→ target</span>,{" "}
        <span className="font-medium text-amber-600 dark:text-amber-400">↑ high</span>.
      </div>

      <div
        className="grid items-start gap-y-4 xl:grid-cols-[var(--receipt-lane)_16px_minmax(0,1fr)_16px_var(--details-lane)] xl:gap-y-0"
        style={laneStyle}
      >
        <aside
          className={`rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 xl:sticky xl:top-4 ${
            outlineCollapsed ? "min-h-12 overflow-hidden p-2 xl:h-[72vh]" : "h-[72vh] space-y-4 overflow-auto p-4"
          }`}
        >
          {outlineCollapsed ? (
            <div className="flex h-full flex-row items-center gap-3 xl:flex-col">
              <button
                type="button"
                onClick={() => setOutlineCollapsed(false)}
                aria-label="Expand receipts lane"
                title="Expand receipts lane"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-zinc-200 text-sm font-semibold hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800"
              >
                +
              </button>
              <div className="text-xs font-medium text-zinc-500 xl:origin-center xl:rotate-90 xl:whitespace-nowrap">
                Receipts
              </div>
            </div>
          ) : (
            <>
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold">Receipts</div>
                    <div className="mt-1 text-xs text-zinc-500">{receiptOutline.length} saved</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setOutlineCollapsed(true)}
                    aria-label="Collapse receipts lane"
                    title="Collapse receipts lane"
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-zinc-200 text-sm font-semibold hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800"
                  >
                    -
                  </button>
                </div>
            <div className="mt-3 space-y-2">
              {receiptOutline.map((receipt) => {
                const active = receipt.id === receiptId;
                return (
                  <Link
                    key={receipt.id}
                    href={`/receipts/${receipt.id}`}
                    className={`block rounded-md border px-3 py-2 text-xs transition-colors ${
                      active
                        ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950"
                        : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800"
                    }`}
                  >
                    <span className="block truncate font-medium">{receipt.vendor ?? "Unknown vendor"}</span>
                    <span className={`mt-1 block ${active ? "opacity-75" : "text-zinc-500"}`}>
                      {formatDate(receipt.purchasedAt)} · {receipt.itemCount} rows
                    </span>
                    <span className={`mt-1 block ${active ? "opacity-75" : "text-zinc-500"}`}>
                      {formatMoney(receipt.total)}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>

          <div className="border-t border-zinc-200 pt-4 dark:border-zinc-800">
            <div className="text-xs font-medium text-zinc-500">View</div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(["table", "pantry", "consumed", "calendar"] as ViewMode[]).map((nextView) => (
                <button
                  key={nextView}
                  type="button"
                  onClick={() => setView(nextView)}
                  className={`rounded-md border px-2 py-2 text-xs font-medium ${
                    view === nextView
                      ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950"
                      : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800"
                  }`}
                >
                  {nextView === "table"
                    ? "Items"
                    : nextView === "pantry"
                      ? "Pantry"
                      : nextView === "consumed"
                        ? "Eaten"
                        : "Calendar"}
                </button>
              ))}
            </div>
          </div>

          <div className="border-t border-zinc-200 pt-4 dark:border-zinc-800">
            <div className="text-xs font-medium text-zinc-500">Plan</div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="text-xs">
                <span className="mb-1 block text-zinc-500">People</span>
                <input
                  type="number"
                  min={1}
                  value={people}
                  onChange={(e) => setPeople(Math.max(Number(e.target.value) || 1, 1))}
                  className="w-full rounded-md border border-zinc-200 bg-transparent px-2 py-2 dark:border-zinc-800"
                />
              </label>
              <label className="text-xs">
                <span className="mb-1 block text-zinc-500">Days</span>
                <input
                  type="number"
                  min={1}
                  value={days}
                  onChange={(e) => setDays(Math.max(Number(e.target.value) || 1, 1))}
                  className="w-full rounded-md border border-zinc-200 bg-transparent px-2 py-2 dark:border-zinc-800"
                />
              </label>
              <label className="col-span-2 text-xs">
                <span className="mb-1 block text-zinc-500">Status date</span>
                <input
                  type="date"
                  value={statusDate}
                  onChange={(e) => setStatusDate(e.target.value)}
                  className="w-full rounded-md border border-zinc-200 bg-transparent px-2 py-2 dark:border-zinc-800"
                />
              </label>
            </div>
            <div className="mt-2">
              <div className="text-base font-semibold leading-tight">
                {days} {days === 1 ? "day" : "days"}
              </div>
              <div className="text-xs text-zinc-500">
                {startDate} – {planEnd}
              </div>
              {windowNote ? (
                <div className="mt-0.5 text-[11px] text-zinc-500">{windowNote}</div>
              ) : null}
              <div className="mt-1 text-[11px] text-zinc-500">
                Excludes disposed, unavailable, and refunded rows.
              </div>
            </div>
            <div className="mt-1 text-xs text-zinc-500">{DAILY_VALUE_BASIS}</div>
          </div>

          <div className="border-t border-zinc-200 pt-4 dark:border-zinc-800">
            <div className="text-xs font-medium text-zinc-500">Receipt state</div>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
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
            </>
          )}
        </aside>

        <div
          role="separator"
          aria-label="Resize receipts lane"
          aria-orientation="vertical"
          aria-valuemin={RECEIPT_LANE_MIN}
          aria-valuemax={RECEIPT_LANE_MAX}
          aria-valuenow={outlineCollapsed ? 52 : outlineWidth}
          tabIndex={0}
          onPointerDown={(event) => startLaneResize(event, "receipt")}
          onKeyDown={(event) => nudgeLane(event, "receipt")}
          className="group hidden h-[72vh] cursor-col-resize touch-none items-stretch justify-center outline-none xl:sticky xl:top-4 xl:flex"
        >
          <span className="my-2 w-px rounded-full bg-zinc-200 transition-colors group-hover:bg-zinc-500 group-focus-visible:bg-zinc-900 dark:bg-zinc-800 dark:group-hover:bg-zinc-500 dark:group-focus-visible:bg-zinc-100" />
        </div>

        {view === "calendar" ? (
          <div className="h-[72vh] space-y-3 overflow-auto rounded-lg border border-zinc-200 bg-zinc-50/60 p-3 dark:border-zinc-800 dark:bg-zinc-950/50">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
              <div>
                <div className="text-sm font-semibold">{calendarTitle(calendarCursor, calendarMode)}</div>
                <div className="text-xs text-zinc-500">
                  {logs.length} logged servings · {formatNumber(consumedTotals.calories)} consumed calories
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setCalendarCursor(moveCalendarCursor(calendarCursor, calendarMode, -1))}
                  className="rounded-md border border-zinc-200 px-3 py-2 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800"
                >
                  Previous
                </button>
                {(["month", "week", "day"] as CalendarMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setCalendarMode(mode)}
                    className={`rounded-md border px-3 py-2 text-xs font-medium ${
                      calendarMode === mode
                        ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950"
                        : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800"
                    }`}
                  >
                    {mode[0].toUpperCase() + mode.slice(1)}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setCalendarCursor(moveCalendarCursor(calendarCursor, calendarMode, 1))}
                  className="rounded-md border border-zinc-200 px-3 py-2 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800"
                >
                  Next
                </button>
              </div>
            </div>
            <div className={calendarMode === "month" ? "grid grid-cols-7 gap-2" : "grid gap-3 md:grid-cols-2 2xl:grid-cols-3"}>
              {calendarDays.map((day) => {
                const dayLogs = logs.filter((log) => datePart(log.consumedAt) === day);
                const dayTotals = computeLogTotals(dayLogs, itemsById);
                const isOutsideMonth = calendarMode === "month" && day.slice(0, 7) !== calendarCursor.slice(0, 7);
                return (
                  <section
                    key={day}
                    className={`min-h-36 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900 ${
                      isOutsideMonth ? "opacity-45" : ""
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-sm font-semibold">{calendarMode === "month" ? day.slice(8) : day}</div>
                        <div className="mt-1 text-xs text-zinc-500">{dayLogs.length} logs</div>
                      </div>
                      <div className="text-right text-xs text-zinc-500">
                        <div>{formatNumber(dayTotals.calories)} cal</div>
                        <div>{formatNumber(dayTotals.proteinG)}g P</div>
                      </div>
                    </div>
                    <div className="mt-3 space-y-2">
                      {dayLogs.length === 0 ? (
                        <div className="text-xs text-zinc-500">No logged servings.</div>
                      ) : (
                        dayLogs.map((log) => {
                          const item = itemsById.get(log.lineItemId);
                          const totals = logTotals(log, item);
                          return (
                            <button
                              key={log.id}
                              type="button"
                              onClick={() => item && toggleSelected(item.id)}
                              className="block w-full rounded-md border border-zinc-200 px-2 py-2 text-left text-xs hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800"
                            >
                              <span className="block truncate font-medium">{item?.rawName ?? "Unknown item"}</span>
                              <span className="mt-1 block text-zinc-500">
                                {log.consumedAt.slice(11, 16)} · {formatNumber(log.amount, 2)} {logUnitLabel(log.unit)} ·{" "}
                                {formatNumber(totals.calories)} cal
                              </span>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>
        ) : (
          renderItemsTable(visibleItems)
        )}

        <div
          role="separator"
          aria-label="Resize details lane"
          aria-orientation="vertical"
          aria-valuemin={DETAILS_LANE_MIN}
          aria-valuemax={DETAILS_LANE_MAX}
          aria-valuenow={detailsCollapsed ? 52 : detailsWidth}
          tabIndex={0}
          onPointerDown={(event) => startLaneResize(event, "details")}
          onKeyDown={(event) => nudgeLane(event, "details")}
          className="group hidden h-[72vh] cursor-col-resize touch-none items-stretch justify-center outline-none xl:sticky xl:top-4 xl:flex"
        >
          <span className="my-2 w-px rounded-full bg-zinc-200 transition-colors group-hover:bg-zinc-500 group-focus-visible:bg-zinc-900 dark:bg-zinc-800 dark:group-hover:bg-zinc-500 dark:group-focus-visible:bg-zinc-100" />
        </div>

        <aside
          className={`rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 xl:sticky xl:top-4 ${
            detailsCollapsed ? "min-h-12 overflow-hidden p-2 xl:h-[72vh]" : "h-[72vh] space-y-4 overflow-auto p-4"
          }`}
        >
          {detailsCollapsed ? (
            <div className="flex h-full flex-row items-center gap-3 xl:flex-col">
              <button
                type="button"
                onClick={() => setDetailsCollapsed(false)}
                aria-label="Expand details lane"
                title="Expand details lane"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-zinc-200 text-sm font-semibold hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800"
              >
                +
              </button>
              <div className="text-xs font-medium text-zinc-500 xl:origin-center xl:rotate-90 xl:whitespace-nowrap">
                Portion details
              </div>
            </div>
          ) : (
            <>
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold">Selected items</div>
                    <div className="mt-1 text-xs text-zinc-500">
                      {selectedTotals.itemCount} selected · {selectedTotals.knownItems} with nutrition totals ·{" "}
                      {formatNumber(selectedTotals.servings, 1)} servings · {formatMassG(selectedTotals.totalGrams)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDetailsCollapsed(true)}
                    aria-label="Collapse details lane"
                    title="Collapse details lane"
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-zinc-200 text-sm font-semibold hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800"
                  >
                    -
                  </button>
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
          {selectedPrimaryItem ? (
            <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-semibold">Edit item</div>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => deleteItem(selectedPrimaryItem.id)}
                  className="text-xs font-medium text-zinc-500 hover:text-red-600 disabled:opacity-50"
                >
                  Delete row
                </button>
              </div>
              <div className="mt-3 space-y-2">
                <label className="block text-xs">
                  <span className="mb-1 block text-zinc-500">Name</span>
                  <input
                    value={itemEdit.rawName}
                    onChange={(e) => setItemEdit((s) => ({ ...s, rawName: e.target.value }))}
                    className="w-full rounded-md border border-zinc-200 bg-transparent px-2 py-2 dark:border-zinc-800"
                  />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-xs">
                    <span className="mb-1 block text-zinc-500">Quantity</span>
                    <input
                      type="number"
                      min={0.01}
                      step={0.01}
                      value={itemEdit.quantity}
                      onChange={(e) => setItemEdit((s) => ({ ...s, quantity: e.target.value }))}
                      className="w-full rounded-md border border-zinc-200 bg-transparent px-2 py-2 dark:border-zinc-800"
                    />
                  </label>
                  <label className="text-xs">
                    <span className="mb-1 block text-zinc-500">Price</span>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      placeholder="—"
                      value={itemEdit.price}
                      onChange={(e) => setItemEdit((s) => ({ ...s, price: e.target.value }))}
                      className="w-full rounded-md border border-zinc-200 bg-transparent px-2 py-2 dark:border-zinc-800"
                    />
                  </label>
                </div>
                <label className="block text-xs">
                  <span className="mb-1 block text-zinc-500">Category</span>
                  <select
                    value={itemEdit.category}
                    onChange={(e) => setItemEdit((s) => ({ ...s, category: e.target.value as Category }))}
                    className="w-full rounded-md border border-zinc-200 bg-transparent px-2 py-2 dark:border-zinc-800"
                  >
                    {CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {CATEGORY_LABELS[cat]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="mt-3">
                <button
                  type="button"
                  disabled={saving || !itemEdit.rawName.trim()}
                  onClick={saveItemEdits}
                  className="rounded-md border border-zinc-900 bg-zinc-900 px-3 py-2 text-xs font-medium text-white disabled:opacity-50 dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950"
                >
                  Save changes
                </button>
              </div>
            </div>
          ) : null}
          <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
            <div className="text-sm font-semibold">Log consumption</div>
            <div className="mt-1 text-xs text-zinc-500">
              {selectedPrimaryItem ? selectedPrimaryItem.rawName : "Select one row to log a serving."}
            </div>
            <div className="mt-3 grid grid-cols-[80px_minmax(0,1fr)] gap-2">
              <label className="text-xs">
                <span className="mb-1 block text-zinc-500">Amount</span>
                <input
                  type="number"
                  min={0.01}
                  step={0.25}
                  value={logAmount}
                  onChange={(e) => setLogAmount(Math.max(Number(e.target.value) || 1, 0.01))}
                  className="w-full rounded-md border border-zinc-200 bg-transparent px-2 py-2 dark:border-zinc-800"
                />
              </label>
              <label className="text-xs">
                <span className="mb-1 block text-zinc-500">Unit</span>
                <select
                  value={logUnit}
                  onChange={(e) => setLogUnit(e.target.value as LogUnit)}
                  className="w-full rounded-md border border-zinc-200 bg-transparent px-2 py-2 dark:border-zinc-800"
                >
                  {LOG_UNITS.map((unit) => (
                    <option key={unit} value={unit}>
                      {logUnitLabel(unit)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="col-span-2 text-xs">
                <span className="mb-1 block text-zinc-500">Date and time</span>
                <input
                  type="datetime-local"
                  value={logAt}
                  onChange={(e) => setLogAt(e.target.value)}
                  className="w-full rounded-md border border-zinc-200 bg-transparent px-2 py-2 dark:border-zinc-800"
                />
              </label>
              <label className="col-span-2 text-xs">
                <span className="mb-1 block text-zinc-500">Note</span>
                <input
                  value={logNote}
                  onChange={(e) => setLogNote(e.target.value)}
                  placeholder="meal, person, prep..."
                  className="w-full rounded-md border border-zinc-200 bg-transparent px-2 py-2 dark:border-zinc-800"
                />
              </label>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!selectedPrimaryItem || saving}
                onClick={logConsumption}
                className="rounded-md border border-zinc-900 bg-zinc-900 px-3 py-2 text-xs font-medium text-white disabled:opacity-50 dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950"
              >
                Log serving
              </button>
              <button
                type="button"
                disabled={!selectedPrimaryItem}
                onClick={() => {
                  setLogAmount(1);
                  setLogUnit("item");
                }}
                className="rounded-md border border-zinc-200 px-3 py-2 text-xs font-medium hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:hover:bg-zinc-800"
              >
                1 item
              </button>
              <button
                type="button"
                disabled={!selectedPrimaryItem}
                onClick={() => {
                  setLogAmount(1);
                  setLogUnit("serving");
                }}
                className="rounded-md border border-zinc-200 px-3 py-2 text-xs font-medium hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:hover:bg-zinc-800"
              >
                1 serving
              </button>
            </div>
            {selectedPrimaryLogs.length > 0 ? (
              <div className="mt-3 space-y-2">
                <div className="text-xs font-medium text-zinc-500">Recent logs for this item</div>
                {selectedPrimaryLogs.slice(0, 4).map((log) => {
                  const totals = logTotals(log, selectedPrimaryItem);
                  return (
                    <div
                      key={log.id}
                      className="flex items-start justify-between gap-2 rounded-md border border-zinc-200 px-2 py-2 text-xs dark:border-zinc-800"
                    >
                      <div>
                        <div className="font-medium">
                          {formatNumber(log.amount, 2)} {logUnitLabel(log.unit)} · {formatNumber(totals.calories)} cal
                        </div>
                        <div className="mt-1 text-zinc-500">{log.consumedAt.replace("T", " ")}</div>
                      </div>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => deleteLog(log.id)}
                        className="text-zinc-500 hover:text-red-600 disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
          <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
            <div className="text-sm font-semibold">Add custom entry</div>
            <div className="mt-1 text-xs text-zinc-500">
              Adds caffeine, alcohol, cannabis, or medication-style rows to this receipt and logs them at the selected time.
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="col-span-2 text-xs">
                <span className="mb-1 block text-zinc-500">Type</span>
                <select
                  value={customType}
                  onChange={(e) => setCustomType(e.target.value as CustomEntryType)}
                  className="w-full rounded-md border border-zinc-200 bg-transparent px-2 py-2 dark:border-zinc-800"
                >
                  {CUSTOM_ENTRY_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </label>
              <label className="col-span-2 text-xs">
                <span className="mb-1 block text-zinc-500">Name</span>
                <input
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  placeholder="Coffee, wine, edible, Adderall..."
                  className="w-full rounded-md border border-zinc-200 bg-transparent px-2 py-2 dark:border-zinc-800"
                />
              </label>
              <label className="text-xs">
                <span className="mb-1 block text-zinc-500">Caffeine mg</span>
                <input
                  type="number"
                  min={0}
                  value={customCaffeineMg}
                  onChange={(e) => setCustomCaffeineMg(Math.max(Number(e.target.value) || 0, 0))}
                  className="w-full rounded-md border border-zinc-200 bg-transparent px-2 py-2 dark:border-zinc-800"
                />
              </label>
              <label className="text-xs">
                <span className="mb-1 block text-zinc-500">Alcohol g</span>
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={customAlcoholG}
                  onChange={(e) => setCustomAlcoholG(Math.max(Number(e.target.value) || 0, 0))}
                  className="w-full rounded-md border border-zinc-200 bg-transparent px-2 py-2 dark:border-zinc-800"
                />
              </label>
              <label className="text-xs">
                <span className="mb-1 block text-zinc-500">THC mg</span>
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={customThcMg}
                  onChange={(e) => setCustomThcMg(Math.max(Number(e.target.value) || 0, 0))}
                  className="w-full rounded-md border border-zinc-200 bg-transparent px-2 py-2 dark:border-zinc-800"
                />
              </label>
              <label className="text-xs">
                <span className="mb-1 block text-zinc-500">CBD mg</span>
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={customCbdMg}
                  onChange={(e) => setCustomCbdMg(Math.max(Number(e.target.value) || 0, 0))}
                  className="w-full rounded-md border border-zinc-200 bg-transparent px-2 py-2 dark:border-zinc-800"
                />
              </label>
              <label className="text-xs">
                <span className="mb-1 block text-zinc-500">CBN mg</span>
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={customCbnMg}
                  onChange={(e) => setCustomCbnMg(Math.max(Number(e.target.value) || 0, 0))}
                  className="w-full rounded-md border border-zinc-200 bg-transparent px-2 py-2 dark:border-zinc-800"
                />
              </label>
              <label className="text-xs">
                <span className="mb-1 block text-zinc-500">CBG mg</span>
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={customCbgMg}
                  onChange={(e) => setCustomCbgMg(Math.max(Number(e.target.value) || 0, 0))}
                  className="w-full rounded-md border border-zinc-200 bg-transparent px-2 py-2 dark:border-zinc-800"
                />
              </label>
              <label className="col-span-2 text-xs">
                <span className="mb-1 block text-zinc-500">Amphetamine mg</span>
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={customAmphetamineMg}
                  onChange={(e) => setCustomAmphetamineMg(Math.max(Number(e.target.value) || 0, 0))}
                  className="w-full rounded-md border border-zinc-200 bg-transparent px-2 py-2 dark:border-zinc-800"
                />
              </label>
            </div>
            <button
              type="button"
              disabled={saving || !customName.trim()}
              onClick={addCustomEntry}
              className="mt-3 w-full rounded-md border border-zinc-900 bg-zinc-900 px-3 py-2 text-xs font-medium text-white disabled:opacity-50 dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950"
            >
              Add and log entry
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            {hasMetricValue(selectedScaledTotals.price) ? (
              <SummaryCard label="Price" value={formatMoney(selectedScaledTotals.price)} />
            ) : null}
            {selectedMetricCards.map((card) => (
              <MetricCard key={card.key} card={card} />
            ))}
            {!hasMetricValue(selectedScaledTotals.price) && selectedMetricCards.length === 0 ? (
              <SummaryCard
                label="Selection"
                value={`${selectedTotals.itemCount}`}
                sub="Select rows with nutrition values to see a compact summary."
              />
            ) : null}
          </div>
          <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">Vitamin & mineral label</div>
                <div className="mt-1 text-xs text-zinc-500">
                  Showing {microSummaryLabel}
                  {selectedItems.length > 0 ? ` as ${rateLabel(selectedRate).toLowerCase()}` : ""}.
                </div>
              </div>
              <span className="rounded-full bg-zinc-100 px-2 py-1 text-xs dark:bg-zinc-800">
                {vitaminEntries.length + mineralEntries.length}
              </span>
            </div>
            <div className="mt-3 grid gap-3 text-xs md:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
              <div>
                <div className="font-medium text-zinc-500">Vitamins</div>
                <div className="mt-2 max-h-40 space-y-1 overflow-auto pr-1">
                  {vitaminEntries.length ? (
                    vitaminEntries.map(([label, value]) => (
                      <div key={label} className="flex justify-between gap-2 rounded bg-zinc-50 px-2 py-1 dark:bg-zinc-950">
                        <span className="truncate">{compactMicroLabel(label)}</span>
                        <span className="shrink-0 font-medium">{formatMicroValue(label, value)}</span>
                      </div>
                    ))
                  ) : (
                    <div className="text-zinc-500">No vitamin details yet.</div>
                  )}
                </div>
              </div>
              <div>
                <div className="font-medium text-zinc-500">Minerals</div>
                <div className="mt-2 max-h-40 space-y-1 overflow-auto pr-1">
                  {mineralEntries.length ? (
                    mineralEntries.map(([label, value]) => (
                      <div key={label} className="flex justify-between gap-2 rounded bg-zinc-50 px-2 py-1 dark:bg-zinc-950">
                        <span className="truncate">{compactMicroLabel(label)}</span>
                        <span className="shrink-0 font-medium">{formatMicroValue(label, value)}</span>
                      </div>
                    ))
                  ) : (
                    <div className="text-zinc-500">No mineral details yet.</div>
                  )}
                </div>
              </div>
            </div>
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
            Selected totals use whole-item nutrition when package size is known. Rows with only a USDA reference show a
            per-100g estimate instead of staying at zero.
          </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
