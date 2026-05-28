import type { ParsedReceipt } from "@/lib/llm/schema";

const MONEY_RE = /^CA\$(\d+(?:\.\d{2})?)$/i;
const QUANTITY_RE = /^(\d+(?:\.\d+)?)\s+(.+?)(?:\s*•)?$/;

const NOISE_LINES = [
  /^My order$/i,
  /^Store thumbnail$/i,
  /^Product thumbnail$/i,
  /^We'll update you here/i,
  /^Replace only with my approval$/i,
  /^Replace with any similar item$/i,
  /^Don(?:'|’)t replace$/i,
  /^\d+\s+Items?$/i,
];

function isNoiseLine(line: string) {
  return NOISE_LINES.some((re) => re.test(line));
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

  return lines.find((line) => /costco/i.test(line)) ?? "Uber Eats";
}

export function parseUberEatsOrderText(text: string): ParsedReceipt | null {
  if (!/My order/i.test(text) || !/\b\d+\s+Items?\b/i.test(text) || !/CA\$\d/i.test(text)) {
    return null;
  }

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const items: ParsedReceipt["items"] = [];

  for (let i = 0; i < lines.length - 2; i++) {
    const name = lines[i];
    const quantity = parseQuantity(lines[i + 1]);
    const priceMatch = lines[i + 2].match(MONEY_RE);

    if (isNoiseLine(name) || !quantity || !priceMatch) continue;

    items.push({
      raw_name: name,
      quantity: quantity.quantity,
      unit: quantity.unit,
      price: Number(priceMatch[1]),
      active_ingredients: null,
    });

    i += 2;
  }

  if (items.length === 0) return null;

  const total = Number(items.reduce((sum, item) => sum + (item.price ?? 0), 0).toFixed(2));

  return {
    is_receipt: true,
    vendor: parseVendor(lines),
    purchased_at: null,
    total,
    items,
  };
}
