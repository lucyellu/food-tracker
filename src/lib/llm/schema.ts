import { z } from "zod";

export const UNITS = [
  "oz",
  "lb",
  "g",
  "kg",
  "mg",
  "fl_oz",
  "ml",
  "l",
  "gal",
  "qt",
  "pt",
  "cup",
  "tbsp",
  "tsp",
  "count",
  "dozen",
  "pack",
] as const;

export type Unit = (typeof UNITS)[number];

export const ParsedItemSchema = z.object({
  raw_name: z.string().min(1),
  quantity: z.number().positive().default(1),
  unit: z.string().default("count"),
  price: z.number().nullable().default(null),
});

export const ParsedReceiptSchema = z.object({
  is_receipt: z.boolean(),
  vendor: z.string().nullable().default(null),
  purchased_at: z.string().nullable().default(null),
  total: z.number().nullable().default(null),
  items: z.array(ParsedItemSchema).default([]),
});

export type ParsedReceipt = z.infer<typeof ParsedReceiptSchema>;
export type ParsedItem = z.infer<typeof ParsedItemSchema>;

export const SYSTEM_PROMPT = `You are a grocery receipt parser. Extract every purchased line item from the given receipt and return strict JSON.

Output schema:
{
  "is_receipt": boolean,
  "vendor": string | null,
  "purchased_at": string | null,   // ISO 8601 date (YYYY-MM-DD) if visible, else null
  "total": number | null,
  "items": [
    { "raw_name": string, "quantity": number, "unit": string, "price": number | null }
  ]
}

Rules:
- "is_receipt" must be false if the input is not actually a receipt (e.g., a shipping confirmation with no line items, marketing email, random text). When false, return empty items.
- "unit" must be one of: oz, lb, g, kg, mg, fl_oz, ml, l, gal, qt, pt, cup, tbsp, tsp, count, dozen, pack. Map any other unit to its closest equivalent. If the receipt does not specify a unit, default to "count".
- "quantity" must be a positive number. Default to 1 if not specified.
- "raw_name" is the item name exactly as it appears on the receipt (preserve brand if shown). Do NOT clean or normalize the name — that happens later.
- "price" is the total price for that line item (quantity x unit price), not the unit price. Use null if not visible.
- Skip subtotal, tax, total, discount, deposit, savings, store credit, bag fee, and payment lines. Only include actual food/grocery items.
- Return ONLY valid JSON. No prose, no markdown, no code fences.`;
