import type { ParsedReceipt } from "@/lib/llm/schema";

const MONEY_RE = /^(?:CA)?\$(\d+(?:\.\d{2})?)$/i;
const MONEY_ANYWHERE_RE = /(?:CA)?\$(\d+(?:\.\d{2})?)/i;
const QUANTITY_RE = /^(\d+(?:\.\d+)?)\s+(.+?)(?:\s*•)?$/;
const UBER_SIGNAL_RE = /\buber\s*eats\b|\bubereats\b|my order|order total|delivery details/i;

const NOISE_LINES = [
  /^My order$/i,
  /^Store thumbnail$/i,
  /^Product thumbnail$/i,
  /^We'll update you here/i,
  /^Replace only with my approval$/i,
  /^Replace with any similar item$/i,
  /^Don(?:'|’)t replace$/i,
  /^\d+\s+Items?$/i,
  /^Subtotal$/i,
  /^Delivery fee$/i,
  /^Service fee$/i,
  /^Tax(?:es)?$/i,
  /^Tip$/i,
  /^Promotion$/i,
  /^Total$/i,
  /^Order total$/i,
  /^Charged$/i,
];

function isNoiseLine(line: string) {
  return NOISE_LINES.some((re) => re.test(line));
}

function isFeeLine(line: string) {
  return /subtotal|delivery fee|service fee|tax|tip|promotion|discount|courier|total|charged|refund/i.test(line);
}

function mapUnit(unit: string) {
  const normalized = unit.toLowerCase().replace(/[().]/g, "").trim();
  if (["count", "ct", "item", "items"].includes(normalized)) return "count";
  if (["lb", "lbs", "pound", "pounds"].includes(normalized)) return "lb";
  if (["kg", "kilogram", "kilograms"].includes(normalized)) return "kg";
  if (["g", "gram", "grams"].includes(normalized)) return "g";
  if (["ml", "milliliter", "milliliters"].includes(normalized)) return "ml";
  if (["l", "liter", "liters"].includes(normalized)) return "l";
  if (["oz", "ounce", "ounces"].includes(normalized)) return "oz";
  if (["pack", "package"].includes(normalized)) return "pack";
  return "count";
}

function parseQuantity(line: string) {
  const match = line.match(QUANTITY_RE);
  if (!match) return null;

  return {
    quantity: Number(match[1]),
    unit: mapUnit(match[2]),
  };
}

function parseVendor(lines: string[]) {
  const storeThumbnailIndex = lines.findIndex((line) => /^Store thumbnail$/i.test(line));
  if (storeThumbnailIndex >= 0) {
    const vendor = lines
      .slice(storeThumbnailIndex + 1)
      .find((line) => !isNoiseLine(line) && !MONEY_RE.test(line));
    if (vendor) return vendor;
  }

  if (lines.some((line) => /costco/i.test(line))) return "Costco";
  return "Uber Eats";
}

function parseTotal(lines: string[]) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const inlineTotal = line.match(/^(?:order\s+total|total|charged)\s+(?:CA)?\$(\d+(?:\.\d{2})?)$/i);
    if (inlineTotal) return Number(inlineTotal[1]);
    if (!/^(order\s+total|total|charged)$/i.test(line)) continue;
    const sameLine = line.match(MONEY_ANYWHERE_RE);
    if (sameLine) return Number(sameLine[1]);
    const nextLine = lines[i + 1]?.match(MONEY_RE);
    if (nextLine) return Number(nextLine[1]);
  }
  return null;
}

function pushUnique(items: ParsedReceipt["items"], item: ParsedReceipt["items"][number]) {
  const key = `${item.raw_name.toLowerCase()}|${item.quantity}|${item.unit}|${item.price ?? ""}`;
  const exists = items.some(
    (existing) =>
      `${existing.raw_name.toLowerCase()}|${existing.quantity}|${existing.unit}|${existing.price ?? ""}` ===
      key,
  );
  if (!exists) items.push(item);
}

function parseInlineItemLine(line: string): ParsedReceipt["items"][number] | null {
  if (isNoiseLine(line) || isFeeLine(line)) return null;

  const prefixQuantity = line.match(/^(?:(\d+(?:\.\d+)?)\s*[x×]\s+)?(.+?)\s+(?:CA)?\$(\d+(?:\.\d{2})?)$/i);
  if (prefixQuantity) {
    return {
      raw_name: prefixQuantity[2].trim(),
      quantity: prefixQuantity[1] ? Number(prefixQuantity[1]) : 1,
      unit: "count",
      price: Number(prefixQuantity[3]),
      category: null,
      active_ingredients: null,
    };
  }

  const suffixQuantity = line.match(/^(.+?)\s+(\d+(?:\.\d+)?)\s*[x×]\s+(?:CA)?\$(\d+(?:\.\d{2})?)$/i);
  if (suffixQuantity) {
    return {
      raw_name: suffixQuantity[1].trim(),
      quantity: Number(suffixQuantity[2]),
      unit: "count",
      price: Number(suffixQuantity[3]),
      category: null,
      active_ingredients: null,
    };
  }

  return null;
}

function parseStructuredItems(lines: string[]) {
  const items: ParsedReceipt["items"] = [];

  for (let i = 0; i < lines.length - 2; i++) {
    const name = lines[i];
    const quantity = parseQuantity(lines[i + 1]);
    const priceMatch = lines[i + 2].match(MONEY_RE);

    if (isNoiseLine(name) || isFeeLine(name) || !quantity || !priceMatch) continue;

    pushUnique(items, {
      raw_name: name,
      quantity: quantity.quantity,
      unit: quantity.unit,
      price: Number(priceMatch[1]),
      category: null,
      active_ingredients: null,
    });

    i += 2;
  }

  return items;
}

function looksLikeUberEatsReceipt(text: string) {
  if (!UBER_SIGNAL_RE.test(text) || !MONEY_ANYWHERE_RE.test(text)) return false;
  return /(?:^|\n).+?(?:CA)?\$\d+(?:\.\d{2})?/i.test(text) || /\b\d+\s+Items?\b/i.test(text);
}

export function parseUberEatsOrderText(text: string): ParsedReceipt | null {
  if (!looksLikeUberEatsReceipt(text)) {
    return null;
  }

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const items = parseStructuredItems(lines);
  for (const line of lines) {
    const item = parseInlineItemLine(line);
    if (item) pushUnique(items, item);
  }

  if (items.length === 0) return null;

  const total = parseTotal(lines) ?? Number(items.reduce((sum, item) => sum + (item.price ?? 0), 0).toFixed(2));

  return {
    is_receipt: true,
    vendor: parseVendor(lines),
    purchased_at: null,
    total,
    items,
  };
}
