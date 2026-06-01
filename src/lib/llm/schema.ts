import { z } from "zod";
import { CATEGORIES } from "@/lib/products/category";

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

const ParsedTerpeneSchema = z.object({
  name: z.string().min(1),
  mg: z.number().nullable().default(null),
  percent: z.number().nullable().default(null),
});

const ParsedActiveIngredientSchema = z
  .object({
    thc_mg: z.number().nullable().default(null),
    cbd_mg: z.number().nullable().default(null),
    cbn_mg: z.number().nullable().default(null),
    cbg_mg: z.number().nullable().default(null),
    thca_mg: z.number().nullable().default(null),
    cbda_mg: z.number().nullable().default(null),
    total_thc_mg: z.number().nullable().default(null),
    total_cbd_mg: z.number().nullable().default(null),
    thc_percent: z.number().nullable().default(null),
    cbd_percent: z.number().nullable().default(null),
    cbn_percent: z.number().nullable().default(null),
    cbg_percent: z.number().nullable().default(null),
    thca_percent: z.number().nullable().default(null),
    cbda_percent: z.number().nullable().default(null),
    total_thc_percent: z.number().nullable().default(null),
    total_cbd_percent: z.number().nullable().default(null),
    package_grams: z.number().nullable().default(null),
    terpenes: z.array(ParsedTerpeneSchema).default([]),
  })
  .nullable()
  .default(null);

export const ParsedItemSchema = z.object({
  raw_name: z.string().min(1),
  quantity: z.number().positive().default(1),
  unit: z.string().default("count"),
  price: z.number().nullable().default(null),
  category: z.enum(CATEGORIES).nullable().default(null),
  active_ingredients: ParsedActiveIngredientSchema,
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

export const SYSTEM_PROMPT = `You are a food, grocery, and cannabis receipt/label parser. Extract every purchased line item from the given receipt and return strict JSON.

Output schema:
{
  "is_receipt": boolean,
  "vendor": string | null,
  "purchased_at": string | null,   // ISO 8601 date (YYYY-MM-DD) if visible, else null
  "total": number | null,
  "items": [
    {
      "raw_name": string,
      "quantity": number,
      "unit": string,
      "price": number | null,
      "category": "food" | "drink" | "cannabis" | "supplement" | "household" | "personal_care" | "other",
      "active_ingredients": {
        "thc_mg": number | null,
        "cbd_mg": number | null,
        "cbn_mg": number | null,
        "cbg_mg": number | null,
        "thca_mg": number | null,
        "cbda_mg": number | null,
        "total_thc_mg": number | null,
        "total_cbd_mg": number | null,
        "thc_percent": number | null,
        "cbd_percent": number | null,
        "cbn_percent": number | null,
        "cbg_percent": number | null,
        "thca_percent": number | null,
        "cbda_percent": number | null,
        "total_thc_percent": number | null,
        "total_cbd_percent": number | null,
        "package_grams": number | null,
        "terpenes": [{ "name": string, "mg": number | null, "percent": number | null }]
      } | null
    }
  ]
}

Rules:
- "is_receipt" must be false if the input is not actually a receipt, itemized order, or useful cannabis product label (e.g., a shipping confirmation with no line items, marketing email, random text). When false, return empty items.
- Cannabis product labels with a product name and visible cannabinoids/terpenes count as useful input even if there is no purchase total. Create one item per product, use price null when no price is visible, and set vendor to Dutch Love or the visible brand/store when present.
- "unit" must be one of: oz, lb, g, kg, mg, fl_oz, ml, l, gal, qt, pt, cup, tbsp, tsp, count, dozen, pack. Map any other unit to its closest equivalent. If the receipt does not specify a unit, default to "count".
- "quantity" must be a positive number. Default to 1 if not specified.
- "category" must be one of: food, drink, cannabis, supplement, household, personal_care, other. Use "cannabis" for any item with cannabinoids/terpenes. Use "drink" for beverages (water, juice, soda, milk, coffee, tea, beer, wine, etc.), "supplement" for vitamins/supplements, "household" for cleaning/paper/non-ingestible goods, "personal_care" for toiletries/cosmetics, and "food" for everything edible. Use "other" only when genuinely unclear.
- "raw_name" is the item name exactly as it appears on the receipt (preserve brand if shown). Do NOT clean or normalize the name — that happens later.
- "price" is the total price for that line item (quantity x unit price), not the unit price. Use null if not visible.
- For cannabis products or cannabis labels (for example Dutch Love), capture visible THC, CBD, CBN, CBG, THCA, CBDA, total THC/CBD, package grams, and terpene values in "active_ingredients". Use mg when the label gives mg; use percent fields when it gives %. If a terpene name and amount/percent is visible, include it in "terpenes". Use null active_ingredients for ordinary groceries.
- Skip subtotal, tax, total, discount, deposit, savings, store credit, bag fee, and payment lines. Only include actual food/grocery/cannabis items.
- Return ONLY valid JSON. No prose, no markdown, no code fences.`;
