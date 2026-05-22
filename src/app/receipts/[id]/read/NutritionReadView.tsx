"use client";

import { useMemo, useState } from "react";
import type { ReceiptTrackerItem } from "../ReceiptNutritionTracker";

type Sex = "female" | "male";
type NutrientKind = "goal" | "watch" | "energy";

type PersonProfile = {
  id: string;
  name: string;
  sex: Sex;
  birthdate: string;
  weightLb: number;
  heightCm: number;
  activity: number;
};

type NutritionMeta = {
  basis?: string;
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

type ReadTotals = {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  sugarG: number;
  sodiumMg: number;
  potassiumMg: number;
  magnesiumMg: number;
  calciumMg: number;
  ironMg: number;
  vitaminAMcg: number;
  vitaminDMcg: number;
  vitaminEMg: number;
  vitaminKMcg: number;
  knownItems: number;
  trackedItems: number;
};

type DailyTargets = Omit<ReadTotals, "knownItems" | "trackedItems"> & {
  vitaminAUpperMcg: number;
  vitaminDUpperMcg: number;
  vitaminEUpperMg: number;
};

type NutrientRow = {
  key: keyof DailyTargets | "saltG";
  label: string;
  value: number;
  target: number;
  unit: string;
  kind: NutrientKind;
  note: string;
  upper?: number;
};

type SourceKey = keyof Pick<
  ReadTotals,
  | "calories"
  | "proteinG"
  | "carbsG"
  | "fatG"
  | "fiberG"
  | "sugarG"
  | "sodiumMg"
  | "potassiumMg"
  | "magnesiumMg"
  | "calciumMg"
  | "ironMg"
  | "vitaminAMcg"
  | "vitaminDMcg"
  | "vitaminEMg"
  | "vitaminKMcg"
>;

const DEFAULT_PROFILES: PersonProfile[] = [
  {
    id: "lucy",
    name: "Lucy",
    sex: "female",
    birthdate: "1991-01-31",
    weightLb: 110,
    heightCm: 165,
    activity: 1.2,
  },
  {
    id: "person-2",
    name: "Person 2",
    sex: "female",
    birthdate: "1991-01-31",
    weightLb: 110,
    heightCm: 165,
    activity: 1.2,
  },
];

const EMPTY_TOTALS: ReadTotals = {
  calories: 0,
  proteinG: 0,
  carbsG: 0,
  fatG: 0,
  fiberG: 0,
  sugarG: 0,
  sodiumMg: 0,
  potassiumMg: 0,
  magnesiumMg: 0,
  calciumMg: 0,
  ironMg: 0,
  vitaminAMcg: 0,
  vitaminDMcg: 0,
  vitaminEMg: 0,
  vitaminKMcg: 0,
  knownItems: 0,
  trackedItems: 0,
};

const FAT_SOLUBLE_KEYS = new Set(["vitaminAMcg", "vitaminDMcg", "vitaminEMg", "vitaminKMcg"]);

const FOOD_SUGGESTIONS: Partial<Record<SourceKey, string[]>> = {
  potassiumMg: [
    "Potatoes or sweet potatoes",
    "White beans, lentils, or edamame",
    "Spinach, beet greens, or Swiss chard",
    "Tomato paste/sauce, bananas, oranges, yogurt, or milk",
  ],
  calciumMg: ["Milk or yogurt", "Calcium-set tofu", "Fortified soy milk", "Canned fish with bones"],
  magnesiumMg: ["Pumpkin seeds", "Almonds or cashews", "Beans and lentils", "Spinach"],
  ironMg: ["Clams, mussels, beef, or sardines", "Lentils and beans", "Spinach", "Iron-fortified grains"],
  vitaminDMcg: ["Salmon, trout, sardines, or tuna", "Fortified milk or soy milk", "Egg yolks", "UV-exposed mushrooms"],
  vitaminEMg: ["Sunflower seeds", "Almonds", "Peanut butter", "Wheat germ oil"],
  vitaminAMcg: ["Sweet potato", "Carrots", "Spinach or kale", "Pumpkin"],
  vitaminKMcg: ["Kale", "Spinach", "Collards", "Broccoli"],
  fiberG: ["Beans and lentils", "Oats", "Berries", "Whole grains and vegetables"],
  proteinG: ["Fish or seafood", "Tofu or tempeh", "Beans and lentils", "Eggs or lean meat"],
};

function parseJsonRecord(value: string | null | undefined) {
  if (!value) return {};
  try {
    return JSON.parse(value) as Record<string, number>;
  } catch {
    return {};
  }
}

function parseMeta(value: string | null | undefined): NutritionMeta {
  if (!value) return {};
  try {
    return JSON.parse(value) as NutritionMeta;
  } catch {
    return {};
  }
}

function valueByLabel(record: Record<string, number>, includes: string[], excludes: string[] = []) {
  const found = Object.entries(record).find(([key]) => {
    const lower = key.toLowerCase();
    return includes.every((part) => lower.includes(part)) && excludes.every((part) => !lower.includes(part));
  });
  return found?.[1] ?? null;
}

function mineralValue(item: ReceiptTrackerItem, name: string) {
  return valueByLabel(parseJsonRecord(item.nutrition?.mineralsJson), [name]);
}

function vitaminAValue(item: ReceiptTrackerItem) {
  const vitamins = parseJsonRecord(item.nutrition?.vitaminsJson);
  return (
    valueByLabel(vitamins, ["vitamin a", "rae"]) ??
    valueByLabel(vitamins, ["retinol"]) ??
    valueByLabel(vitamins, ["vitamin a"], ["iu"])
  );
}

function vitaminDValue(item: ReceiptTrackerItem) {
  const vitamins = parseJsonRecord(item.nutrition?.vitaminsJson);
  const mcg = valueByLabel(vitamins, ["vitamin d"], ["iu"]);
  if (mcg != null) return mcg;
  const iu = valueByLabel(vitamins, ["vitamin d", "iu"]);
  return iu == null ? null : iu / 40;
}

function vitaminEValue(item: ReceiptTrackerItem) {
  const vitamins = parseJsonRecord(item.nutrition?.vitaminsJson);
  return valueByLabel(vitamins, ["vitamin e"]) ?? valueByLabel(vitamins, ["tocopherol"]);
}

function vitaminKValue(item: ReceiptTrackerItem) {
  return valueByLabel(parseJsonRecord(item.nutrition?.vitaminsJson), ["vitamin k"]);
}

function rowValues(item: ReceiptTrackerItem) {
  const meta = parseMeta(item.nutrition?.activeIngredientsJson);
  const per100gOnly = meta.basis === "per_100g_reference_only";
  const n = item.nutrition;
  return {
    calories: per100gOnly ? meta.per100g?.calories : n?.calories,
    proteinG: per100gOnly ? meta.per100g?.proteinG : n?.proteinG,
    carbsG: per100gOnly ? meta.per100g?.carbsG : n?.carbsG,
    fatG: per100gOnly ? meta.per100g?.fatG : n?.fatG,
    fiberG: per100gOnly ? meta.per100g?.fiberG : n?.fiberG,
    sugarG: per100gOnly ? meta.per100g?.sugarG : n?.sugarG,
    sodiumMg: per100gOnly ? (meta.per100gMinerals?.sodiumMg ?? meta.per100g?.sodiumMg) : n?.sodiumMg,
    potassiumMg: per100gOnly ? meta.per100gMinerals?.potassiumMg : mineralValue(item, "potassium"),
    magnesiumMg: per100gOnly ? meta.per100gMinerals?.magnesiumMg : mineralValue(item, "magnesium"),
    calciumMg: per100gOnly ? meta.per100gMinerals?.calciumMg : mineralValue(item, "calcium"),
    ironMg: per100gOnly ? meta.per100gMinerals?.ironMg : mineralValue(item, "iron"),
    vitaminAMcg: per100gOnly ? null : vitaminAValue(item),
    vitaminDMcg: per100gOnly ? null : vitaminDValue(item),
    vitaminEMg: per100gOnly ? null : vitaminEValue(item),
    vitaminKMcg: per100gOnly ? null : vitaminKValue(item),
    canTotal: Boolean(n?.totalGrams),
  };
}

function trackedForPlan(item: ReceiptTrackerItem) {
  return !["disposed", "unavailable", "refunded"].includes(item.consumptionStatus);
}

function computeTotals(items: ReceiptTrackerItem[]) {
  return items.reduce<ReadTotals>((acc, item) => {
    if (!trackedForPlan(item)) return acc;
    acc.trackedItems += 1;
    const values = rowValues(item);
    if (!values.canTotal) return acc;
    acc.knownItems += 1;
    acc.calories += values.calories ?? 0;
    acc.proteinG += values.proteinG ?? 0;
    acc.carbsG += values.carbsG ?? 0;
    acc.fatG += values.fatG ?? 0;
    acc.fiberG += values.fiberG ?? 0;
    acc.sugarG += values.sugarG ?? 0;
    acc.sodiumMg += values.sodiumMg ?? 0;
    acc.potassiumMg += values.potassiumMg ?? 0;
    acc.magnesiumMg += values.magnesiumMg ?? 0;
    acc.calciumMg += values.calciumMg ?? 0;
    acc.ironMg += values.ironMg ?? 0;
    acc.vitaminAMcg += values.vitaminAMcg ?? 0;
    acc.vitaminDMcg += values.vitaminDMcg ?? 0;
    acc.vitaminEMg += values.vitaminEMg ?? 0;
    acc.vitaminKMcg += values.vitaminKMcg ?? 0;
    return acc;
  }, { ...EMPTY_TOTALS });
}

function ageOn(birthdate: string, at = new Date()) {
  const birth = new Date(`${birthdate}T00:00:00`);
  if (Number.isNaN(birth.getTime())) return 35;
  let age = at.getFullYear() - birth.getFullYear();
  const monthDelta = at.getMonth() - birth.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && at.getDate() < birth.getDate())) age -= 1;
  return Math.max(age, 1);
}

function kg(profile: PersonProfile) {
  return profile.weightLb * 0.45359237;
}

function bmr(profile: PersonProfile) {
  const sexOffset = profile.sex === "female" ? -161 : 5;
  return 10 * kg(profile) + 6.25 * profile.heightCm - 5 * ageOn(profile.birthdate) + sexOffset;
}

function targetsForProfile(profile: PersonProfile): DailyTargets {
  const calories = Math.max(1200, bmr(profile) * profile.activity);
  const age = ageOn(profile.birthdate);
  const female = profile.sex === "female";
  return {
    calories,
    proteinG: Math.max(kg(profile) * 0.8, female ? 46 : 56),
    carbsG: (calories * 0.45) / 4,
    fatG: (calories * 0.3) / 9,
    fiberG: female ? (age > 50 ? 21 : 25) : age > 50 ? 30 : 38,
    sugarG: (calories * 0.1) / 4,
    sodiumMg: 2300,
    potassiumMg: female ? 2600 : 3400,
    magnesiumMg: female ? 320 : 420,
    calciumMg: female && age > 50 ? 1200 : 1000,
    ironMg: female && age <= 50 ? 18 : 8,
    vitaminAMcg: female ? 700 : 900,
    vitaminDMcg: age > 70 ? 20 : 15,
    vitaminEMg: 15,
    vitaminKMcg: female ? 90 : 120,
    vitaminAUpperMcg: 3000,
    vitaminDUpperMcg: 100,
    vitaminEUpperMg: 1000,
  };
}

function averageTargets(profiles: PersonProfile[]) {
  const safeProfiles = profiles.length ? profiles : DEFAULT_PROFILES;
  const summed = safeProfiles.reduce<DailyTargets>(
    (acc, profile) => {
      const target = targetsForProfile(profile);
      Object.keys(acc).forEach((key) => {
        const typedKey = key as keyof DailyTargets;
        acc[typedKey] += target[typedKey];
      });
      return acc;
    },
    {
      calories: 0,
      proteinG: 0,
      carbsG: 0,
      fatG: 0,
      fiberG: 0,
      sugarG: 0,
      sodiumMg: 0,
      potassiumMg: 0,
      magnesiumMg: 0,
      calciumMg: 0,
      ironMg: 0,
      vitaminAMcg: 0,
      vitaminDMcg: 0,
      vitaminEMg: 0,
      vitaminKMcg: 0,
      vitaminAUpperMcg: 0,
      vitaminDUpperMcg: 0,
      vitaminEUpperMg: 0,
    },
  );
  Object.keys(summed).forEach((key) => {
    const typedKey = key as keyof DailyTargets;
    summed[typedKey] /= safeProfiles.length;
  });
  return summed;
}

function scaledDaily(totals: ReadTotals, people: number, days: number): ReadTotals {
  const divisor = Math.max(people, 1) * Math.max(days, 1);
  const next = { ...totals };
  Object.keys(next).forEach((key) => {
    const typedKey = key as keyof ReadTotals;
    if (typedKey === "knownItems" || typedKey === "trackedItems") return;
    next[typedKey] = next[typedKey] / divisor;
  });
  return next;
}

function fmt(value: number, digits = 0) {
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function saltG(sodiumMg: number) {
  return (sodiumMg * 2.542) / 1000;
}

function percent(value: number, target: number) {
  if (!target) return 0;
  return (value / target) * 100;
}

function toneFor(row: NutrientRow) {
  const pct = percent(row.value, row.target);
  if (row.upper && row.value >= row.upper * 0.85) return "border-orange-300 bg-orange-50 text-orange-950 dark:border-orange-900 dark:bg-orange-950/30 dark:text-orange-100";
  if (row.kind === "watch") {
    if (pct > 140) return "border-orange-300 bg-orange-50 text-orange-950 dark:border-orange-900 dark:bg-orange-950/30 dark:text-orange-100";
    if (pct > 105) return "border-yellow-300 bg-yellow-50 text-yellow-950 dark:border-yellow-900 dark:bg-yellow-950/30 dark:text-yellow-100";
    return "border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100";
  }
  if (pct < 50) return "border-red-300 bg-red-50 text-red-950 dark:border-red-900 dark:bg-red-950/30 dark:text-red-100";
  if (pct < 85) return "border-rose-300 bg-rose-50 text-rose-950 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-100";
  if (pct <= 130) return "border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100";
  return "border-yellow-300 bg-yellow-50 text-yellow-950 dark:border-yellow-900 dark:bg-yellow-950/30 dark:text-yellow-100";
}

function barColor(row: NutrientRow) {
  const pct = percent(row.value, row.target);
  if (row.upper && row.value >= row.upper * 0.85) return "bg-orange-500";
  if (row.kind === "watch") {
    if (pct > 140) return "bg-orange-500";
    if (pct > 105) return "bg-yellow-500";
    return "bg-emerald-500";
  }
  if (pct < 50) return "bg-red-500";
  if (pct < 85) return "bg-rose-500";
  if (pct <= 130) return "bg-emerald-500";
  return "bg-yellow-500";
}

function signalLabel(row: NutrientRow) {
  const pct = percent(row.value, row.target);
  if (row.upper && row.value >= row.upper * 0.85) return "Near upper limit";
  if (row.kind === "watch") return pct > 105 ? "Watch high" : "Within limit";
  if (pct < 85) return "Low";
  if (pct <= 130) return "On target";
  return FAT_SOLUBLE_KEYS.has(String(row.key)) ? "Watch buildup" : "Above target";
}

function updateProfile(profiles: PersonProfile[], id: string, patch: Partial<PersonProfile>) {
  return profiles.map((profile) => (profile.id === id ? { ...profile, ...patch } : profile));
}

function rowSourceKey(row: NutrientRow): SourceKey | null {
  return row.key === "saltG" || row.key.includes("Upper") ? null : (row.key as SourceKey);
}

function itemSourceValue(item: ReceiptTrackerItem, row: NutrientRow) {
  const key = rowSourceKey(row);
  if (!key) return null;
  const values = rowValues(item);
  return values.canTotal ? values[key] ?? null : null;
}

function topSources(items: ReceiptTrackerItem[], row: NutrientRow) {
  const sources = items
    .map((item) => ({
      id: item.id,
      name: item.rawName,
      value: itemSourceValue(item, row),
    }))
    .filter((item): item is { id: number; name: string; value: number } => item.value != null && item.value > 0)
    .sort((a, b) => b.value - a.value);
  const total = sources.reduce((sum, source) => sum + source.value, 0);

  return sources.slice(0, 4).map((source) => ({
    ...source,
    share: total > 0 ? (source.value / total) * 100 : 0,
  }));
}

function addDaysToIso(iso: string | null, days: number) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const date = new Date(`${iso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function NutritionReadView({
  purchasedAt,
  initialItems,
}: {
  purchasedAt: string | null;
  initialItems: ReceiptTrackerItem[];
}) {
  const [days, setDays] = useState(7);
  const [profiles, setProfiles] = useState<PersonProfile[]>(DEFAULT_PROFILES);
  const [reverseCalories, setReverseCalories] = useState(1500);

  const totals = useMemo(() => computeTotals(initialItems), [initialItems]);
  const daily = useMemo(() => scaledDaily(totals, profiles.length, days), [totals, profiles.length, days]);
  const targets = useMemo(() => averageTargets(profiles), [profiles]);
  const planEnd = addDaysToIso(purchasedAt, days);

  const rows = useMemo<NutrientRow[]>(
    () => [
      { key: "calories", label: "Energy", value: daily.calories, target: targets.calories, unit: "cal", kind: "energy", note: "Mifflin estimate" },
      { key: "proteinG", label: "Protein", value: daily.proteinG, target: targets.proteinG, unit: "g", kind: "goal", note: "Minimum daily coverage" },
      { key: "fiberG", label: "Fiber", value: daily.fiberG, target: targets.fiberG, unit: "g", kind: "goal", note: "Usually aim higher" },
      { key: "carbsG", label: "Carbs", value: daily.carbsG, target: targets.carbsG, unit: "g", kind: "goal", note: "45% energy baseline" },
      { key: "fatG", label: "Fat", value: daily.fatG, target: targets.fatG, unit: "g", kind: "watch", note: "Yellow/orange if high" },
      { key: "sugarG", label: "Total sugar", value: daily.sugarG, target: targets.sugarG, unit: "g", kind: "watch", note: "Uses added-sugar style cap" },
      { key: "sodiumMg", label: "Sodium", value: daily.sodiumMg, target: targets.sodiumMg, unit: "mg", kind: "watch", note: "Limit nutrient" },
      { key: "saltG", label: "Salt equivalent", value: saltG(daily.sodiumMg), target: saltG(targets.sodiumMg), unit: "g", kind: "watch", note: "Calculated from sodium" },
      { key: "potassiumMg", label: "Potassium", value: daily.potassiumMg, target: targets.potassiumMg, unit: "mg", kind: "goal", note: "Electrolyte coverage" },
      { key: "calciumMg", label: "Calcium", value: daily.calciumMg, target: targets.calciumMg, unit: "mg", kind: "goal", note: "Bone support" },
      { key: "magnesiumMg", label: "Magnesium", value: daily.magnesiumMg, target: targets.magnesiumMg, unit: "mg", kind: "goal", note: "Electrolyte/mineral" },
      { key: "ironMg", label: "Iron", value: daily.ironMg, target: targets.ironMg, unit: "mg", kind: "goal", note: "Personalized by sex/age" },
      { key: "vitaminAMcg", label: "Vitamin A", value: daily.vitaminAMcg, target: targets.vitaminAMcg, unit: "mcg", kind: "goal", note: "Fat-soluble", upper: targets.vitaminAUpperMcg },
      { key: "vitaminDMcg", label: "Vitamin D", value: daily.vitaminDMcg, target: targets.vitaminDMcg, unit: "mcg", kind: "goal", note: "Fat-soluble", upper: targets.vitaminDUpperMcg },
      { key: "vitaminEMg", label: "Vitamin E", value: daily.vitaminEMg, target: targets.vitaminEMg, unit: "mg", kind: "goal", note: "Fat-soluble", upper: targets.vitaminEUpperMg },
      { key: "vitaminKMcg", label: "Vitamin K", value: daily.vitaminKMcg, target: targets.vitaminKMcg, unit: "mcg", kind: "goal", note: "Fat-soluble" },
    ],
    [daily, targets],
  );

  const lowRows = rows.filter((row) => row.kind !== "watch" && percent(row.value, row.target) < 85);
  const highRows = rows.filter((row) => signalLabel(row).includes("Watch") || signalLabel(row).includes("Above") || signalLabel(row).includes("upper"));
  const strongestLow = [...lowRows].sort((a, b) => percent(a.value, a.target) - percent(b.value, b.target)).slice(0, 4);
  const strongestHigh = [...highRows].sort((a, b) => percent(b.value, b.target) - percent(a.value, a.target)).slice(0, 3);
  const reverseDays = totals.calories > 0 ? totals.calories / (Math.max(profiles.length, 1) * Math.max(reverseCalories, 1)) : 0;
  const reversePeople = totals.calories > 0 ? totals.calories / (Math.max(days, 1) * Math.max(reverseCalories, 1)) : 0;
  const receiptPersonDays = totals.calories > 0 ? totals.calories / Math.max(reverseCalories, 1) : 0;

  return (
    <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
      <aside className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900 xl:sticky xl:top-4 xl:max-h-[78vh] xl:overflow-auto">
        <div>
          <div className="text-sm font-semibold">Settings</div>
          <div className="mt-1 text-xs text-zinc-500">
            {profiles.length} people · {purchasedAt}
            {planEnd ? ` to ${planEnd}` : ""}
          </div>
        </div>

        <label className="block text-xs">
          <span className="mb-1 block text-zinc-500">Days in receipt plan</span>
          <input
            type="number"
            min={1}
            value={days}
            onChange={(event) => setDays(Math.max(1, Number(event.target.value) || 1))}
            className="w-full rounded-md border border-zinc-200 bg-transparent px-2 py-2 dark:border-zinc-800"
          />
        </label>

        <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
          <div className="text-sm font-semibold">Reverse planner</div>
          <div className="mt-1 text-xs text-zinc-500">Ask how far this receipt goes at a target daily calorie level.</div>
          <label className="mt-3 block text-xs">
            <span className="mb-1 block text-zinc-500">Daily calories to test</span>
            <input
              type="number"
              min={1}
              value={reverseCalories}
              onChange={(event) => setReverseCalories(Math.max(1, Number(event.target.value) || 1))}
              className="w-full rounded-md border border-zinc-200 bg-transparent px-2 py-2 dark:border-zinc-800"
            />
          </label>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded bg-zinc-50 p-2 dark:bg-zinc-950">
              <div className="text-lg font-semibold">{fmt(receiptPersonDays, 1)}</div>
              <div className="text-zinc-500">person-days</div>
            </div>
            <div className="rounded bg-zinc-50 p-2 dark:bg-zinc-950">
              <div className="text-lg font-semibold">{fmt(reverseDays, 1)}</div>
              <div className="text-zinc-500">days for {profiles.length}</div>
            </div>
            <div className="rounded bg-zinc-50 p-2 dark:bg-zinc-950">
              <div className="text-lg font-semibold">{fmt(reversePeople, 1)}</div>
              <div className="text-zinc-500">people for {days}d</div>
            </div>
          </div>
        </div>

        <div className="space-y-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
          {profiles.map((profile) => (
            <div key={profile.id} className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
              <div className="flex items-center justify-between gap-2">
                <input
                  value={profile.name}
                  onChange={(event) => setProfiles((current) => updateProfile(current, profile.id, { name: event.target.value }))}
                  className="min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none"
                  aria-label="Person name"
                />
                <button
                  type="button"
                  disabled={profiles.length <= 1}
                  onClick={() => setProfiles((current) => current.filter((item) => item.id !== profile.id))}
                  className="text-xs text-zinc-500 hover:text-red-600 disabled:opacity-40"
                >
                  Remove
                </button>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <label className="text-xs">
                  <span className="mb-1 block text-zinc-500">Sex</span>
                  <select
                    value={profile.sex}
                    onChange={(event) => setProfiles((current) => updateProfile(current, profile.id, { sex: event.target.value as Sex }))}
                    className="w-full rounded-md border border-zinc-200 bg-transparent px-2 py-1.5 dark:border-zinc-800"
                  >
                    <option value="female">Female</option>
                    <option value="male">Male</option>
                  </select>
                </label>
                <label className="text-xs">
                  <span className="mb-1 block text-zinc-500">Birthday</span>
                  <input
                    type="date"
                    value={profile.birthdate}
                    onChange={(event) => setProfiles((current) => updateProfile(current, profile.id, { birthdate: event.target.value }))}
                    className="w-full rounded-md border border-zinc-200 bg-transparent px-2 py-1.5 dark:border-zinc-800"
                  />
                </label>
                <label className="text-xs">
                  <span className="mb-1 block text-zinc-500">Weight lb</span>
                  <input
                    type="number"
                    min={1}
                    value={profile.weightLb}
                    onChange={(event) => setProfiles((current) => updateProfile(current, profile.id, { weightLb: Math.max(1, Number(event.target.value) || 1) }))}
                    className="w-full rounded-md border border-zinc-200 bg-transparent px-2 py-1.5 dark:border-zinc-800"
                  />
                </label>
                <label className="text-xs">
                  <span className="mb-1 block text-zinc-500">Height cm</span>
                  <input
                    type="number"
                    min={1}
                    value={profile.heightCm}
                    onChange={(event) => setProfiles((current) => updateProfile(current, profile.id, { heightCm: Math.max(1, Number(event.target.value) || 1) }))}
                    className="w-full rounded-md border border-zinc-200 bg-transparent px-2 py-1.5 dark:border-zinc-800"
                  />
                </label>
              </div>
              <div className="mt-2 text-xs text-zinc-500">
                {ageOn(profile.birthdate)} yrs · {fmt(targetsForProfile(profile).calories)} cal target
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() =>
            setProfiles((current) => [
              ...current,
              { ...DEFAULT_PROFILES[0], id: `person-${Date.now()}`, name: `Person ${current.length + 1}` },
            ])
          }
          className="w-full rounded-md border border-zinc-200 px-3 py-2 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800"
        >
          Add person
        </button>
      </aside>

      <section className="space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">Read first</div>
            <div className="mt-2 text-2xl font-semibold">
              {lowRows.length === 0 && highRows.length === 0 ? "Mostly balanced" : `${lowRows.length} low · ${highRows.length} watch`}
            </div>
            <div className="mt-2 text-sm text-zinc-500">
              {totals.knownItems} of {totals.trackedItems} tracked rows have usable whole-item nutrition.
            </div>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">Lowest coverage</div>
            <div className="mt-2 space-y-1 text-sm">
              {strongestLow.length ? strongestLow.map((row) => <div key={row.label}>{row.label}: {fmt(percent(row.value, row.target))}%</div>) : "No major gaps."}
            </div>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">Watch high</div>
            <div className="mt-2 space-y-1 text-sm">
              {strongestHigh.length ? strongestHigh.map((row) => <div key={row.label}>{row.label}: {fmt(percent(row.value, row.target))}%</div>) : "No strong over-target signals."}
            </div>
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          {strongestLow.slice(0, 4).map((row) => {
            const sources = topSources(initialItems, row);
            const suggestions = FOOD_SUGGESTIONS[rowSourceKey(row) ?? "potassiumMg"] ?? [];
            return (
              <section key={row.label} className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">Raise {row.label}</div>
                    <div className="mt-1 text-xs text-zinc-500">
                      This receipt covers {fmt(percent(row.value, row.target))}% of the daily target per person.
                    </div>
                  </div>
                  <span className="rounded-full bg-red-100 px-2 py-1 text-xs font-medium text-red-800 dark:bg-red-950/40 dark:text-red-200">
                    low
                  </span>
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div>
                    <div className="text-xs font-medium text-zinc-500">Biggest sources in this receipt</div>
                    <div className="mt-2 space-y-2 text-xs">
                      {sources.length ? (
                        sources.map((source) => (
                          <div key={source.id} className="rounded bg-zinc-50 px-2 py-1.5 dark:bg-zinc-950">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="truncate font-medium">{source.name}</div>
                                <div className="mt-0.5 text-zinc-500">
                                  {fmt(source.value, source.value < 10 ? 1 : 0)} {row.unit}
                                </div>
                              </div>
                              <div className="shrink-0 text-right font-semibold">{fmt(source.share)}%</div>
                            </div>
                            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                              <div
                                className="h-full rounded-full bg-emerald-500"
                                style={{ width: `${Math.min(Math.max(source.share, 2), 100)}%` }}
                              />
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="text-zinc-500">No item-level source data yet.</div>
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-zinc-500">Useful foods to buy more often</div>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                      {suggestions.length ? (
                        suggestions.map((suggestion) => (
                          <span key={suggestion} className="rounded-full bg-zinc-100 px-2 py-1 dark:bg-zinc-800">
                            {suggestion}
                          </span>
                        ))
                      ) : (
                        <span className="text-zinc-500">Add more whole-food sources for this nutrient.</span>
                      )}
                    </div>
                  </div>
                </div>
              </section>
            );
          })}
        </div>

        <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
          {rows.map((row) => {
            const pct = percent(row.value, row.target);
            const cappedWidth = Math.min(Math.max(pct, 2), 160);
            return (
              <article key={row.label} className={`rounded-lg border p-4 ${toneFor(row)}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">{row.label}</div>
                    <div className="mt-1 text-xs opacity-75">{row.note}</div>
                  </div>
                  <div className="rounded-full bg-white/65 px-2 py-1 text-xs font-medium text-zinc-900 dark:bg-zinc-950/40 dark:text-zinc-100">
                    {signalLabel(row)}
                  </div>
                </div>
                <div className="mt-4 flex items-end justify-between gap-3">
                  <div>
                    <div className="text-2xl font-semibold">
                      {fmt(row.value, row.value < 10 ? 1 : 0)}
                      <span className="ml-1 text-sm font-normal">{row.unit}</span>
                    </div>
                    <div className="mt-1 text-xs opacity-75">
                      target {fmt(row.target, row.target < 10 ? 1 : 0)} {row.unit}
                    </div>
                  </div>
                  <div className="text-right text-xl font-semibold">{fmt(pct)}%</div>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/70 dark:bg-zinc-950/50">
                  <div className={`h-full rounded-full ${barColor(row)}`} style={{ width: `${cappedWidth}%` }} />
                </div>
                {row.upper ? (
                  <div className="mt-2 text-xs opacity-75">
                    upper {fmt(row.upper, row.upper < 10 ? 1 : 0)} {row.unit}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
