import type { ParsedReceipt } from "@/lib/llm/schema";

const SKU_RE = /^\d{8}$/;
const MONEY_RE = /^\$(\d+(?:\.\d{2})?)$/;

function parseQuantity(line: string) {
  const lbMatch = line.match(/^(\d+(?:\.\d+)?)\s*lb\s+x\s+\$\d+(?:\.\d{2})\/lb$/i);
  if (lbMatch) {
    return { quantity: Number(lbMatch[1]), unit: "lb" };
  }

  const countMatch = line.match(/^(\d+(?:\.\d+)?)\s+x\s+\$\d+(?:\.\d{2})$/i);
  if (countMatch) {
    return { quantity: Number(countMatch[1]), unit: "count" };
  }

  return { quantity: 1, unit: "count" };
}

export function parseTntPackedOrderEmail(text: string): ParsedReceipt | null {
  if (!/T&T Shop Online/i.test(text) || !/ORDER\s+#\d+/i.test(text) || !/Fulfilled Items/i.test(text)) {
    return null;
  }

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const orderTotalsIndex = lines.findIndex((line) => /^ORDER TOTALS$/i.test(line));
  const fulfilledIndex = lines
    .map((line, index) => (/^Fulfilled Items$/i.test(line) ? index : -1))
    .filter((index) => index >= 0)
    .pop();

  if (fulfilledIndex == null || orderTotalsIndex < fulfilledIndex) {
    return null;
  }

  const section = lines.slice(fulfilledIndex + 1, orderTotalsIndex);
  const items: ParsedReceipt["items"] = [];

  for (let i = 1; i < section.length; i++) {
    if (!SKU_RE.test(section[i]) || !section[i - 1]) continue;

    const qtyLine = section[i + 1] ?? "";
    const amountLabelIndex = section.findIndex((line, index) => index > i && /^Amount$/i.test(line));
    const priceLine = amountLabelIndex >= 0 ? section[amountLabelIndex + 1] : null;
    const priceMatch = priceLine?.match(MONEY_RE);
    if (!priceMatch) continue;

    const { quantity, unit } = parseQuantity(qtyLine);
    items.push({
      raw_name: section[i - 1],
      quantity,
      unit,
      price: Number(priceMatch[1]),
      category: null,
      active_ingredients: null,
    });
    i = amountLabelIndex + 1;
  }

  const orderNumber = text.match(/ORDER\s+#(\d+)/i)?.[1];
  const purchasedAt = text.match(/Delivery Date\s+([A-Za-z]+ \d{1,2}, \d{4})/i)?.[1];
  const total = text.match(/Order Total\s+\$(\d+(?:\.\d{2})?)/i)?.[1];

  return {
    is_receipt: items.length > 0,
    vendor: "T&T Supermarket",
    purchased_at: purchasedAt ? new Date(purchasedAt).toISOString().slice(0, 10) : null,
    total: total ? Number(total) : null,
    items,
  };
}
