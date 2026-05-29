import "server-only";

import { eq } from "drizzle-orm";
import { db, schema } from "@/db/client";

type LineItem = typeof schema.lineItems.$inferSelect;
type Product = typeof schema.productCatalog.$inferSelect;

type ProductCatalogInput = {
  vendor?: string | null;
  rawName: string;
  retailerSku?: string | null;
  normalizedName?: string | null;
  brand?: string | null;
  productSource?: string | null;
  productUrl?: string | null;
  productImageUrl?: string | null;
  fdcId?: number | null;
};

export type ProductCatalogPatch = Pick<
  ProductCatalogInput,
  "normalizedName" | "brand" | "retailerSku" | "productSource" | "productUrl" | "productImageUrl" | "fdcId"
>;

function cleanText(value: string | null | undefined) {
  const text = value?.trim();
  return text ? text : null;
}

function cleanDisplayName(value: string) {
  return value.replace(/^\[REFUNDED\]\s*/i, "").replace(/\s+/g, " ").trim();
}

function skuKey(value: string | null | undefined) {
  return cleanText(value)?.replace(/[^a-z0-9]+/gi, "").toLowerCase() ?? null;
}

export function normalizeProductName(value: string) {
  return cleanDisplayName(value)
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function vendorCatalogKey(value: string | null | undefined) {
  const normalized = cleanText(value)
    ?.toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "unknown";
  if (/\b(t and t|tnt|t t)\b/.test(normalized)) return "tnt";
  if (/\bcostco\b/.test(normalized)) return "costco";
  if (/\bprice\s*smart\b/.test(normalized)) return "pricesmart";
  if (/\buber\s*eats\b/.test(normalized)) return "ubereats";
  if (/\bdutch\s*love\b/.test(normalized)) return "dutch-love";
  return normalized.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
}

export function productCatalogKey(input: Pick<ProductCatalogInput, "vendor" | "rawName" | "retailerSku">) {
  const vendorKey = vendorCatalogKey(input.vendor);
  const sku = skuKey(input.retailerSku);
  if (sku) return `sku:${vendorKey}:${sku}`;

  const name = normalizeProductName(input.rawName);
  return name ? `name:${vendorKey}:${name}` : null;
}

function productValues(input: ProductCatalogInput) {
  return {
    normalizedName: cleanText(input.normalizedName),
    brand: cleanText(input.brand),
    retailerSku: cleanText(input.retailerSku),
    productSource: cleanText(input.productSource),
    productUrl: cleanText(input.productUrl),
    productImageUrl: cleanText(input.productImageUrl),
    fdcId: typeof input.fdcId === "number" ? input.fdcId : null,
  };
}

function mergeProductPatch(product: Product, input: ProductCatalogInput): Product {
  const patch = productValues(input);
  return {
    ...product,
    normalizedName: patch.normalizedName ?? product.normalizedName,
    brand: patch.brand ?? product.brand,
    retailerSku: patch.retailerSku ?? product.retailerSku,
    productSource: patch.productSource ?? product.productSource,
    productUrl: patch.productUrl ?? product.productUrl,
    productImageUrl: patch.productImageUrl ?? product.productImageUrl,
    fdcId: patch.fdcId ?? product.fdcId,
  };
}

export async function syncProductCatalogMetadata(productId: number | null | undefined, patch: ProductCatalogPatch) {
  if (!productId) return;
  const values = productValues({ rawName: "", ...patch });
  const set: Partial<typeof schema.productCatalog.$inferInsert> = {};
  if (values.normalizedName) set.normalizedName = values.normalizedName;
  if (values.brand) set.brand = values.brand;
  if (values.retailerSku) set.retailerSku = values.retailerSku;
  if (values.productSource) set.productSource = values.productSource;
  if (values.productUrl) set.productUrl = values.productUrl;
  if (values.productImageUrl) set.productImageUrl = values.productImageUrl;
  if (values.fdcId != null) set.fdcId = values.fdcId;
  if (Object.keys(set).length === 0) return;

  await db
    .update(schema.productCatalog)
    .set({ ...set, updatedAt: new Date() })
    .where(eq(schema.productCatalog.id, productId));
}

export async function getOrCreateCatalogProductForLineItem(input: ProductCatalogInput) {
  const key = productCatalogKey(input);
  if (!key) return null;

  const displayName = cleanDisplayName(input.rawName) || input.rawName.trim() || "Unknown item";
  const values = productValues(input);
  const [created] = await db
    .insert(schema.productCatalog)
    .values({
      productKey: key,
      displayName,
      normalizedName: values.normalizedName,
      brand: values.brand,
      retailerSku: values.retailerSku,
      productSource: values.productSource,
      productUrl: values.productUrl,
      productImageUrl: values.productImageUrl,
      fdcId: values.fdcId,
    })
    .onConflictDoNothing({ target: schema.productCatalog.productKey })
    .returning();

  const product =
    created ??
    (
      await db
        .select()
        .from(schema.productCatalog)
        .where(eq(schema.productCatalog.productKey, key))
        .limit(1)
    )[0] ??
    null;

  if (!product) return null;
  if (!created) await syncProductCatalogMetadata(product.id, values);
  return mergeProductPatch(product, input);
}

export async function linkLineItemToCatalog(item: LineItem, vendor: string | null | undefined) {
  const product = await getOrCreateCatalogProductForLineItem({
    vendor,
    rawName: item.rawName,
    retailerSku: item.retailerSku,
    normalizedName: item.normalizedName,
    brand: item.brand,
    productSource: item.productSource,
    productUrl: item.productUrl,
    productImageUrl: item.productImageUrl,
    fdcId: item.fdcId,
  });
  if (!product) return null;

  if (item.productId !== product.id) {
    await db
      .update(schema.lineItems)
      .set({ productId: product.id })
      .where(eq(schema.lineItems.id, item.id));
  }

  return product;
}

export function mergeCatalogFieldsIntoLineItem<T extends LineItem>(item: T, product: Product | null): T {
  if (!product) return item;
  return {
    ...item,
    normalizedName: item.normalizedName ?? product.normalizedName,
    brand: item.brand ?? product.brand,
    retailerSku: item.retailerSku ?? product.retailerSku,
    productSource: item.productSource ?? product.productSource,
    productUrl: item.productUrl ?? product.productUrl,
    productImageUrl: item.productImageUrl ?? product.productImageUrl,
    fdcId: item.fdcId ?? product.fdcId,
  };
}
