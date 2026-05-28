import type { ParsedReceipt } from "@/lib/llm/schema";
import { normalizeReceiptDate } from "@/lib/receipts/dates";

function cleanName(value: string) {
  return value.replace(/\s+/g, " ").replace(/\s+-\s+/g, " - ").trim();
}

function parseMoney(text: string, label: RegExp) {
  const match = text.match(label);
  return match?.[1] ? Number(match[1].replace(/,/g, "")) : null;
}

function parseItems(sectionLines: string[]) {
  const items: ParsedReceipt["items"] = [];
  let pendingName: string[] = [];

  for (const line of sectionLines) {
    if (/^out of stock$/i.test(line)) {
      items.pop();
      pendingName = [];
      continue;
    }
    if (/^gram$/i.test(line)) continue;

    const qtyIndex = line.search(/qty\s*:/i);
    if (qtyIndex === -1) {
      pendingName.push(line);
      continue;
    }

    const namePart = line.slice(0, qtyIndex);
    const quantityPart = line.slice(qtyIndex).match(/qty\s*:\s*(\d+(?:\.\d+)?)/i);
    const outOfStock = /out of stock/i.test(line);
    if (namePart.trim()) pendingName.push(namePart);

    const name = cleanName(pendingName.join(" "));
    pendingName = [];
    if (!name || !quantityPart || outOfStock) continue;

    items.push({
      raw_name: name,
      quantity: Number(quantityPart[1]),
      unit: "count",
      price: null,
      active_ingredients: null,
    });
  }

  return items;
}

export function parsePriceSmartOrderText(text: string): ParsedReceipt | null {
  if (!/PriceSmart Foods/i.test(text) || !/Items Ordered/i.test(text) || !/Order Summary/i.test(text)) {
    return null;
  }

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const start = lines.findIndex((line) => /^Items Ordered/i.test(line));
  const end = lines.findIndex((line, index) => index > start && /^Order Summary/i.test(line));
  if (start === -1 || end === -1 || end <= start) return null;

  const sectionLines = lines.slice(start + 1, end);
  const items = parseItems(sectionLines);
  if (items.length === 0) return null;

  const orderNumber = text.match(/Order\s*#\s*:?\s*([A-Z0-9-]+)/i)?.[1];
  const dateText = text.match(/\bDate\s*:\s*([0-9]{1,2}\/[0-9]{1,2}\/(?:19|20)[0-9]{2})/i)?.[1];
  const total =
    parseMoney(text, /Estimated Total\s*:?\s*\$([0-9,]+(?:\.[0-9]{2})?)/i) ??
    parseMoney(text, /Estimated Order Value\s*:?\s*\$([0-9,]+(?:\.[0-9]{2})?)/i);

  return {
    is_receipt: true,
    vendor: orderNumber ? `PriceSmart Foods - Order #${orderNumber}` : "PriceSmart Foods",
    purchased_at: normalizeReceiptDate(dateText),
    total,
    items,
  };
}
