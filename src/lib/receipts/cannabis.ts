import type { ParsedItem } from "@/lib/llm/schema";

type ActiveKey =
  | "thcMg"
  | "cbdMg"
  | "cbnMg"
  | "cbgMg"
  | "thcaMg"
  | "cbdaMg"
  | "totalThcMg"
  | "totalCbdMg";

type PercentKey =
  | "thcPercent"
  | "cbdPercent"
  | "cbnPercent"
  | "cbgPercent"
  | "thcaPercent"
  | "cbdaPercent"
  | "totalThcPercent"
  | "totalCbdPercent";

type Terpene = {
  name: string;
  mg?: number | null;
  percent?: number | null;
};

type CannabisActive = Partial<Record<ActiveKey | PercentKey, number | null>> & {
  terpeneMg?: number | null;
  terpenePercent?: number | null;
};

const CANNABIS_SIGNAL_RE =
  /\b(dutch\s*love|cannabis|thc|cbd|cbn|cbg|thca|cbda|terpene|pre[-\s]?roll|preroll|flower|indica|sativa|hybrid|rosin|hash|vape|cart|edible|gumm(?:y|ies)|joint)\b/i;

const COMPOUNDS: Array<{
  label: string;
  mgKey: ActiveKey;
  percentKey: PercentKey;
}> = [
  { label: "total\\s+thc", mgKey: "totalThcMg", percentKey: "totalThcPercent" },
  { label: "total\\s+cbd", mgKey: "totalCbdMg", percentKey: "totalCbdPercent" },
  { label: "thca", mgKey: "thcaMg", percentKey: "thcaPercent" },
  { label: "cbda", mgKey: "cbdaMg", percentKey: "cbdaPercent" },
  { label: "thc", mgKey: "thcMg", percentKey: "thcPercent" },
  { label: "cbd", mgKey: "cbdMg", percentKey: "cbdPercent" },
  { label: "cbn", mgKey: "cbnMg", percentKey: "cbnPercent" },
  { label: "cbg", mgKey: "cbgMg", percentKey: "cbgPercent" },
];

const PARSED_ACTIVE_FIELDS: Array<[keyof NonNullable<ParsedItem["active_ingredients"]>, ActiveKey]> = [
  ["thc_mg", "thcMg"],
  ["cbd_mg", "cbdMg"],
  ["cbn_mg", "cbnMg"],
  ["cbg_mg", "cbgMg"],
  ["thca_mg", "thcaMg"],
  ["cbda_mg", "cbdaMg"],
  ["total_thc_mg", "totalThcMg"],
  ["total_cbd_mg", "totalCbdMg"],
];

const PARSED_PERCENT_FIELDS: Array<[keyof NonNullable<ParsedItem["active_ingredients"]>, PercentKey]> = [
  ["thc_percent", "thcPercent"],
  ["cbd_percent", "cbdPercent"],
  ["cbn_percent", "cbnPercent"],
  ["cbg_percent", "cbgPercent"],
  ["thca_percent", "thcaPercent"],
  ["cbda_percent", "cbdaPercent"],
  ["total_thc_percent", "totalThcPercent"],
  ["total_cbd_percent", "totalCbdPercent"],
];

const TERPENE_NAMES = [
  "myrcene",
  "limonene",
  "pinene",
  "alpha pinene",
  "beta pinene",
  "linalool",
  "caryophyllene",
  "beta caryophyllene",
  "terpinolene",
  "humulene",
  "ocimene",
  "bisabolol",
  "farnesene",
  "camphene",
  "borneol",
  "guaiol",
  "nerolidol",
  "eucalyptol",
  "terpineol",
].sort((a, b) => b.length - a.length);

function finite(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function round(value: number | null | undefined, digits = 3) {
  if (value == null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function mergeNumber(target: Record<string, number | null | undefined>, key: string, value: number | null) {
  if (value == null) return;
  target[key] = round(value);
}

function valueToMg(value: number, unit: string, packageGrams: number | null) {
  const normalized = unit.toLowerCase();
  if (normalized === "mg") return value;
  if (normalized === "mg/g" && packageGrams) return value * packageGrams;
  if (normalized === "%" && packageGrams) return (value / 100) * packageGrams * 1000;
  return null;
}

function extractPackageGramsFromName(name: string) {
  const multi = name.match(/\b(\d+(?:\.\d+)?)\s*[xX]\s*(\d+(?:\.\d+)?)\s*g(?:rams?)?\b/i);
  if (multi) return Number(multi[1]) * Number(multi[2]);

  const grams = name.match(/\b(\d+(?:\.\d+)?)\s*g(?:rams?)?\b/i);
  if (grams) return Number(grams[1]);

  return null;
}

function packageGramsForItem(item: ParsedItem) {
  const fromParsed = finite(item.active_ingredients?.package_grams);
  if (fromParsed) return fromParsed;

  const unit = item.unit.toLowerCase();
  if (unit === "g") return item.quantity;
  if (unit === "kg") return item.quantity * 1000;
  if (unit === "mg") return item.quantity / 1000;

  return extractPackageGramsFromName(item.raw_name);
}

function readCompoundsFromText(text: string, packageGrams: number | null) {
  const active: CannabisActive = {};

  for (const compound of COMPOUNDS) {
    const labelFirst = new RegExp(
      `\\b${compound.label}\\b\\s*(?:total|activated|content)?\\s*[:\\-]?\\s*(\\d+(?:\\.\\d+)?)\\s*(mg\\/g|mg|%)`,
      "gi",
    );
    const valueFirst = new RegExp(
      `(\\d+(?:\\.\\d+)?)\\s*(mg\\/g|mg|%)\\s*(?:total\\s+)?\\b${compound.label}\\b`,
      "gi",
    );

    for (const regex of [labelFirst, valueFirst]) {
      for (const match of text.matchAll(regex)) {
        const value = Number(match[1]);
        const unit = match[2].toLowerCase();
        if (!Number.isFinite(value)) continue;
        if (unit === "%") mergeNumber(active, compound.percentKey, value);
        mergeNumber(active, compound.mgKey, valueToMg(value, unit, packageGrams));
      }
    }
  }

  const totalTerpenes = text.match(/\b(?:total\s+)?terpenes?\b\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*(mg\/g|mg|%)/i);
  if (totalTerpenes) {
    const value = Number(totalTerpenes[1]);
    const unit = totalTerpenes[2].toLowerCase();
    if (unit === "%") mergeNumber(active, "terpenePercent", value);
    mergeNumber(active, "terpeneMg", valueToMg(value, unit, packageGrams));
  }

  return active;
}

function readTerpenesFromText(text: string, packageGrams: number | null) {
  const terpenes: Terpene[] = [];
  const seen = new Set<string>();

  for (const terpene of TERPENE_NAMES) {
    const label = terpene.replace(/\s+/g, "\\s+");
    const labelFirst = new RegExp(`\\b${label}\\b\\s*[:\\-]?\\s*(\\d+(?:\\.\\d+)?)\\s*(mg\\/g|mg|%)`, "i");
    const valueFirst = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(mg\\/g|mg|%)\\s*\\b${label}\\b`, "i");
    const match = text.match(labelFirst) ?? text.match(valueFirst);
    if (!match) continue;

    const value = Number(match[1]);
    const unit = match[2].toLowerCase();
    const key = terpene.toLowerCase();
    if (!Number.isFinite(value) || seen.has(key)) continue;
    seen.add(key);
    terpenes.push({
      name: terpene.replace(/\b\w/g, (char) => char.toUpperCase()),
      percent: unit === "%" ? round(value) : null,
      mg: round(valueToMg(value, unit, packageGrams)),
    });
  }

  return terpenes;
}

function readParsedActive(item: ParsedItem, packageGrams: number | null) {
  const parsed = item.active_ingredients;
  const active: CannabisActive = {};
  const terpenes: Terpene[] = [];
  if (!parsed) return { active, terpenes };

  for (const [source, target] of PARSED_ACTIVE_FIELDS) {
    mergeNumber(active, target, finite(parsed[source]));
  }
  for (const [source, target] of PARSED_PERCENT_FIELDS) {
    const percent = finite(parsed[source]);
    mergeNumber(active, target, percent);
    if (percent != null) {
      const mgKey = target.replace("Percent", "Mg") as ActiveKey;
      mergeNumber(active, mgKey, valueToMg(percent, "%", packageGrams));
    }
  }

  for (const terpene of parsed.terpenes ?? []) {
    const name = terpene.name?.trim();
    if (!name) continue;
    const percent = finite(terpene.percent);
    const mg = finite(terpene.mg) ?? (percent == null ? null : valueToMg(percent, "%", packageGrams));
    terpenes.push({ name, percent: round(percent), mg: round(mg) });
  }

  return { active, terpenes };
}

function hasActiveValues(active: CannabisActive, terpenes: Terpene[]) {
  return (
    Object.values(active).some((value) => value != null && Number.isFinite(value)) ||
    terpenes.some((terpene) => terpene.mg != null || terpene.percent != null)
  );
}

export function cannabisNutritionForParsedItem(item: ParsedItem) {
  const hasSignal = CANNABIS_SIGNAL_RE.test(item.raw_name) || Boolean(item.active_ingredients);
  if (!hasSignal) return null;

  const packageGrams = packageGramsForItem(item);
  const parsed = readParsedActive(item, packageGrams);
  const inferredActive = readCompoundsFromText(item.raw_name, packageGrams);
  const inferredTerpenes = readTerpenesFromText(item.raw_name, packageGrams);
  const active: CannabisActive = {
    ...inferredActive,
    ...parsed.active,
  };
  const terpenes = [...inferredTerpenes, ...parsed.terpenes];

  if (active.thcMg == null && active.totalThcMg != null) active.thcMg = active.totalThcMg;
  if (active.cbdMg == null && active.totalCbdMg != null) active.cbdMg = active.totalCbdMg;
  if (!hasActiveValues(active, terpenes)) return null;

  return {
    totalGrams: packageGrams,
    alcoholG: null,
    caffeineMg: null,
    vitaminsJson: "{}",
    mineralsJson: "{}",
    activeIngredientsJson: JSON.stringify({
      source: item.active_ingredients ? "receipt_label" : "item_name",
      basis: "manual_entry",
      entryType: "cannabis",
      packageGrams,
      active,
      terpenes,
    }),
  };
}
