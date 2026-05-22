import { eq } from "drizzle-orm";
import { db, schema } from "@/db/client";

const TNT_GRAPHQL_URL = "https://www.tntsupermarket.com/graphql";

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

export async function enrichTntProductsForReceipt(receiptId: number) {
  const items = await db
    .select()
    .from(schema.lineItems)
    .where(eq(schema.lineItems.receiptId, receiptId));

  const result = { total: items.length, linked: 0, fallbackLinks: 0, failed: 0 };

  for (const item of items) {
    const sku = item.retailerSku;
    const query = sku || item.rawName.replace(/^\[REFUNDED\]\s*/i, "");

    try {
      const products = await searchTntProducts(query);
      const product = bestProduct(products, sku, item.rawName);
      const url = tntProductUrl(product?.url_key) ?? tntSearchUrl(query);
      const imageUrl = product?.small_image?.url ?? product?.image?.url ?? product?.thumbnail?.url ?? null;

      await db
        .update(schema.lineItems)
        .set({
          productSource: "T&T",
          productUrl: url,
          productImageUrl: imageUrl,
        })
        .where(eq(schema.lineItems.id, item.id));

      if (product) result.linked += 1;
      else result.fallbackLinks += 1;
    } catch {
      await db
        .update(schema.lineItems)
        .set({
          productSource: "T&T",
          productUrl: tntSearchUrl(query),
        })
        .where(eq(schema.lineItems.id, item.id));
      result.failed += 1;
    }
  }

  return result;
}
