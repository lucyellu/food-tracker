import { inArray } from "drizzle-orm";
import { db, schema } from "@/db/client";
import type { ParsedReceipt } from "@/lib/llm/schema";
import { receiptDedupeSignature, receiptHeaderSignature } from "@/lib/receipts/signature";

function parsedItems(parsed: ParsedReceipt) {
  return parsed.items.map((item) => ({
    rawName: item.raw_name,
    quantity: item.quantity,
    unit: item.unit,
    price: item.price,
  }));
}

export async function findDuplicateParsedReceipt(parsed: ParsedReceipt, purchasedAt: string | null) {
  const header = receiptHeaderSignature({
    vendor: parsed.vendor,
    purchasedAt,
    total: parsed.total,
  });
  const incomingSignature = receiptDedupeSignature(
    {
      vendor: parsed.vendor,
      purchasedAt,
      total: parsed.total,
    },
    parsedItems(parsed),
  );
  if (!header || !incomingSignature) return null;

  const candidates = await db
    .select({
      id: schema.receipts.id,
      vendor: schema.receipts.vendor,
      purchasedAt: schema.receipts.purchasedAt,
      total: schema.receipts.total,
      sourceMessageId: schema.receipts.sourceMessageId,
    })
    .from(schema.receipts);

  const matchingCandidates = candidates.filter(
    (receipt) =>
      receiptHeaderSignature({
        vendor: receipt.vendor,
        purchasedAt: receipt.purchasedAt,
        total: receipt.total,
      }) === header,
  );
  if (matchingCandidates.length === 0) return null;

  const candidateIds = matchingCandidates.map((receipt) => receipt.id);
  const items = await db
    .select({
      receiptId: schema.lineItems.receiptId,
      rawName: schema.lineItems.rawName,
      quantity: schema.lineItems.quantity,
      unit: schema.lineItems.unit,
      price: schema.lineItems.price,
    })
    .from(schema.lineItems)
    .where(inArray(schema.lineItems.receiptId, candidateIds));

  const itemsByReceiptId = new Map<number, typeof items>();
  for (const item of items) {
    const receiptItems = itemsByReceiptId.get(item.receiptId) ?? [];
    receiptItems.push(item);
    itemsByReceiptId.set(item.receiptId, receiptItems);
  }

  return (
    matchingCandidates.find((receipt) => {
      const signature = receiptDedupeSignature(receipt, itemsByReceiptId.get(receipt.id) ?? []);
      return signature === incomingSignature;
    }) ?? null
  );
}
