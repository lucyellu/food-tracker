export type GmailMerchantPresetId = "all" | "tnt" | "pricesmart" | "ubereats";

export type GmailMerchantPreset = {
  id: GmailMerchantPresetId;
  label: string;
  query: string;
  vendorPatterns: RegExp[];
  orderPatterns: RegExp[];
};

export const GMAIL_MERCHANT_PRESETS: GmailMerchantPreset[] = [
  {
    id: "all",
    label: "All receipt-like emails",
    query: "(receipt OR order OR invoice)",
    vendorPatterns: [/receipt|order|invoice/i],
    orderPatterns: [],
  },
  {
    id: "tnt",
    label: "T&T Supermarket",
    query: '(from:tntsupermarket.com OR from:customer.service@tntsupermarket.com OR "T&T Shop Online" OR "T&T Supermarket")',
    vendorPatterns: [/t&t/i, /tntsupermarket/i],
    orderPatterns: [/ORDER\s+#\s*([A-Z0-9-]+)/i, /Order\s+Number\s*:?\s*([A-Z0-9-]+)/i],
  },
  {
    id: "pricesmart",
    label: "PriceSmart Foods",
    query: '("PriceSmart" OR "PriceSmart Foods" OR from:pricesmartfoods.com OR from:e-pricesmartfoods.com OR from:saveonfoods.com)',
    vendorPatterns: [/pricesmart/i, /price smart/i],
    orderPatterns: [
      /ORDER\s*#\s*:?\s*([A-Z0-9-]+)/i,
      /Order\s+Number\s*:?\s*([A-Z0-9-]+)/i,
      /Receipt\s+#\s*([A-Z0-9-]+)/i,
    ],
  },
  {
    id: "ubereats",
    label: "Uber Eats",
    query: '(from:uber.com OR from:ubereats.com OR "Uber Eats" OR "Uber Receipt" OR "Order total")',
    vendorPatterns: [/uber\s*eats/i, /\bubereats\b/i],
    orderPatterns: [
      /Order\s*#\s*([A-Z0-9-]+)/i,
      /Order\s+number\s*:?\s*([A-Z0-9-]+)/i,
      /Receipt\s*#\s*([A-Z0-9-]+)/i,
    ],
  },
];

export function getGmailMerchantPreset(id: string | null | undefined) {
  return GMAIL_MERCHANT_PRESETS.find((preset) => preset.id === id) ?? GMAIL_MERCHANT_PRESETS[0];
}

export function normalizeOrderToken(value: string) {
  return value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

function isPlausibleOrderToken(value: string) {
  return value.length >= 5 && /[0-9]/.test(value);
}

export function extractMerchantOrderKey(text: string, presetId: GmailMerchantPresetId = "all") {
  const presets = presetId === "all" ? GMAIL_MERCHANT_PRESETS.filter((preset) => preset.id !== "all") : [getGmailMerchantPreset(presetId)];

  for (const preset of presets) {
    const vendorMatches = preset.vendorPatterns.some((pattern) => pattern.test(text));
    if (!vendorMatches) continue;

    for (const pattern of preset.orderPatterns) {
      const match = text.match(pattern);
      const orderNumber = match?.[1] ? normalizeOrderToken(match[1]) : null;
      if (orderNumber && isPlausibleOrderToken(orderNumber)) return `${preset.id}:order:${orderNumber}`;
    }
  }

  return null;
}

export function gmailQueryForPreset(presetId: GmailMerchantPresetId, days: number) {
  const preset = getGmailMerchantPreset(presetId);
  const clampedDays = Math.min(Math.max(Math.floor(days), 1), 3650);
  return `newer_than:${clampedDays}d ${preset.query}`;
}
