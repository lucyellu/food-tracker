import { eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import {
  linkLineItemToCatalog,
  syncProductCatalogMetadata,
} from "@/lib/products/catalog";
import {
  enrichLineItemWithOpenFoodFacts,
  openFoodFactsSearchLimitPerReceipt,
} from "@/lib/products/open-food-facts";

const TNT_GRAPHQL_URL = "https://www.tntsupermarket.com/graphql";
const CANNABIS_PRODUCT_RE =
  /\b(dutch\s*love|cannabis|thc|cbd|cbn|cbg|thca|cbda|terpene|pre[-\s]?roll|preroll|flower|indica|sativa|hybrid|rosin|hash|vape|cart|edible|gumm(?:y|ies)|joint)\b/i;

type TntProduct = {
  sku: string;
  name: string;
  url_key?: string;
  small_image?: {
    url?: string;
  };
  image?: {
    url?: string;
  };
  thumbnail?: {
    url?: string;
  };
};

type TntProductsResponse = {
  data?: {
    products?: {
      items?: TntProduct[];
    };
  };
  errors?: Array<{ message?: string }>;
};

function tntProductUrl(urlKey: string | null | undefined) {
  if (!urlKey) return null;
  return `https://www.tntsupermarket.com/eng/${urlKey}.html`;
}

function tntSearchUrl(query: string) {
  return `https://www.tntsupermarket.com/eng/catalogsearch/result/?q=${encodeURIComponent(query)}`;
}

function dutchLoveSearchUrl(query: string) {
  return `https://dutch.love/search?q=${encodeURIComponent(query)}`;
}

function cleanProductQuery(item: typeof schema.lineItems.$inferSelect) {
  return (item.retailerSku || item.rawName.replace(/^\[REFUNDED\]\s*/i, "")).trim() || item.rawName;
}

function cannabisSignalForItem(item: typeof schema.lineItems.$inferSelect, receiptVendor: string | null | undefined) {
  return `${receiptVendor ?? ""} ${item.rawName} ${item.normalizedName ?? ""} ${item.brand ?? ""} ${
    item.productSource ?? ""
  }`;
}

function isCannabisProduct(item: typeof schema.lineItems.$inferSelect, receiptVendor: string | null | undefined) {
  return CANNABIS_PRODUCT_RE.test(cannabisSignalForItem(item, receiptVendor));
}

function isDutchLoveProduct(item: typeof schema.lineItems.$inferSelect, receiptVendor: string | null | undefined) {
  return /\bdutch\s*love\b/i.test(cannabisSignalForItem(item, receiptVendor));
}

async function searchTntProducts(query: string) {
  const res = await fetch(TNT_GRAPHQL_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "FoodTracker/0.1 local app",
    },
    body: JSON.stringify({
      query: `
        query ProductSearch($search: String!) {
          products(search: $search, pageSize: 8) {
            items {
              sku
              name
              url_key
              small_image { url }
              image { url }
              thumbnail { url }
            }
          }
        }
      `,
      variables: { search: query },
    }),
  });

  const data = (await res.json()) as TntProductsResponse;
  if (!res.ok || data.errors?.length) {
    const message = data.errors?.[0]?.message ?? `T&T product lookup failed (${res.status})`;
    throw new Error(message);
  }
  return data.data?.products?.items ?? [];
}

function bestProduct(items: TntProduct[], sku: string | null, rawName: string) {
  if (sku) {
    const exact = items.find((item) => item.sku === sku);
    if (exact) return exact;
  }

  const normalizedRaw = rawName.toLowerCase();
  return (
    items.find((item) => normalizedRaw.includes(item.name.toLowerCase()) || item.name.toLowerCase().includes(normalizedRaw)) ??
    items[0] ??
    null
  );
}

export async function enrichProductsForReceipt(receiptId: number) {
  const receipt = await db.query.receipts.findFirst({
    where: eq(schema.receipts.id, receiptId),
  });
  const items = await db
    .select()
    .from(schema.lineItems)
    .where(eq(schema.lineItems.receiptId, receiptId));

  const result = {
    total: items.length,
    linked: 0,
    fallbackLinks: 0,
    failed: 0,
    skipped: 0,
    openFoodFactsLinked: 0,
    openFoodFactsNutrition: 0,
    openFoodFactsSearches: 0,
    openFoodFactsErrors: 0,
  };
  const openFoodFactsSearchLimit = openFoodFactsSearchLimitPerReceipt();

  for (const item of items) {
    const catalogProduct = await linkLineItemToCatalog(item, receipt?.vendor);
    const productId = catalogProduct?.id ?? item.productId;
    const sku = item.retailerSku;
    const query = cleanProductQuery(item);

    if (isDutchLoveProduct(item, receipt?.vendor)) {
      const productUrl = dutchLoveSearchUrl(query);
      await syncProductCatalogMetadata(productId, {
        productSource: "Dutch Love",
        productUrl,
      });
      if (!productId) {
        await db
          .update(schema.lineItems)
          .set({
            productSource: "Dutch Love",
            productUrl,
          })
          .where(eq(schema.lineItems.id, item.id));
      }

      if (catalogProduct?.productImageUrl ?? item.productImageUrl) result.linked += 1;
      else result.fallbackLinks += 1;
      continue;
    }

    if (isCannabisProduct(item, receipt?.vendor)) {
      result.skipped += 1;
      continue;
    }

    const openFoodFactsResult = await enrichLineItemWithOpenFoodFacts({
      item: { ...item, productId },
      product: catalogProduct,
      allowSearch: result.openFoodFactsSearches < openFoodFactsSearchLimit,
    });
    if (openFoodFactsResult.searched) result.openFoodFactsSearches += 1;
    if (openFoodFactsResult.error) result.openFoodFactsErrors += 1;
    if (openFoodFactsResult.matched) {
      result.linked += 1;
      result.openFoodFactsLinked += 1;
      if (openFoodFactsResult.nutritionMatched) result.openFoodFactsNutrition += 1;
      continue;
    }

    try {
      const products = await searchTntProducts(query);
      const product = bestProduct(products, sku, item.rawName);
      const url = tntProductUrl(product?.url_key) ?? tntSearchUrl(query);
      const imageUrl = product?.small_image?.url ?? product?.image?.url ?? product?.thumbnail?.url ?? null;

      await syncProductCatalogMetadata(productId, {
        productSource: "T&T",
        productUrl: url,
        productImageUrl: imageUrl,
      });
      if (!productId) {
        await db
          .update(schema.lineItems)
          .set({
            productSource: "T&T",
            productUrl: url,
            productImageUrl: imageUrl,
          })
          .where(eq(schema.lineItems.id, item.id));
      }

      if (product) result.linked += 1;
      else result.fallbackLinks += 1;
    } catch {
      const productUrl = tntSearchUrl(query);
      await syncProductCatalogMetadata(productId, {
        productSource: "T&T",
        productUrl,
      });
      if (!productId) {
        await db
          .update(schema.lineItems)
          .set({
            productSource: "T&T",
            productUrl,
          })
          .where(eq(schema.lineItems.id, item.id));
      }
      result.failed += 1;
    }
  }

  return result;
}

export const enrichTntProductsForReceipt = enrichProductsForReceipt;
