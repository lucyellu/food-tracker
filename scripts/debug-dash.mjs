import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "../src/db/schema.js";
import { desc, eq, sql } from "drizzle-orm";
import { receiptDedupeSignature, receiptHeaderSignature } from "../src/lib/receipts/signature.ts";

async function main() {
  const client = createClient({ url: "file:./tmp/food-tracker-local.db" });
  const db = drizzle(client, { schema });

  const receipts = await db.select({
      id: schema.receipts.id,
      vendor: schema.receipts.vendor,
      purchasedAt: schema.receipts.purchasedAt,
      total: schema.receipts.total,
    }).from(schema.receipts).orderBy(desc(schema.receipts.createdAt));
    
  const items = await db.select({
      id: schema.lineItems.id,
      receiptId: schema.lineItems.receiptId,
      rawName: schema.lineItems.rawName,
      quantity: schema.lineItems.quantity,
      unit: schema.lineItems.unit,
      price: schema.lineItems.price,
    }).from(schema.lineItems);

  const itemsByReceiptId = new Map();
  for (const item of items) {
    const list = itemsByReceiptId.get(item.receiptId) ?? [];
    list.push(item);
    itemsByReceiptId.set(item.receiptId, list);
  }

  const bySignature = new Map();
  for (const receipt of receipts) {
    const rItems = itemsByReceiptId.get(receipt.id) ?? [];
    const sig = receiptDedupeSignature(
      { vendor: receipt.vendor, purchasedAt: receipt.purchasedAt, total: receipt.total },
      rItems.map(i => ({ rawName: i.rawName, quantity: i.quantity, unit: i.unit, price: i.price }))
    ) ?? receiptHeaderSignature({ vendor: receipt.vendor, purchasedAt: receipt.purchasedAt, total: receipt.total });
    if (!sig) continue;
    
    const group = bySignature.get(sig) ?? [];
    group.push(receipt);
    bySignature.set(sig, group);
  }

  const dupes = [...bySignature.values()].filter(g => g.length > 1);
  const primaryIds = new Set(receipts.map(r => r.id));
  for (const group of dupes) {
    const [primary, ...rest] = group.sort((a,b) => a.id - b.id);
    for (const r of rest) primaryIds.delete(r.id);
  }

  console.log("Is 205 primary?", primaryIds.has(205));
  if (!primaryIds.has(205)) {
    const group = [...bySignature.values()].find(g => g.some(r => r.id === 205));
    console.log("205 group:", group);
  }

  client.close();
}
main().catch(console.error);
