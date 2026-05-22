import { db, schema } from "@/db/client";
import type { ParsedReceipt } from "@/lib/llm/schema";

type PersistReceiptInput = {
  parsed: ParsedReceipt;
  source: typeof schema.receipts.$inferInsert.source;
  rawInputKind: typeof schema.receipts.$inferInsert.rawInputKind;
  rawInputRef: string | null;
  sourceMessageId?: string | null;
};

export async function persistParsedReceipt({
  parsed,
  source,
  rawInputKind,
  rawInputRef,
  sourceMessageId = null,
}: PersistReceiptInput) {
  const [receipt] = await db
    .insert(schema.receipts)
    .values({
      vendor: parsed.vendor,
      purchasedAt: parsed.purchased_at,
      total: parsed.total,
      source,
      sourceMessageId,
      rawInputKind,
      rawInputRef,
      parseStatus: "parsed",
    })
    .returning();

  if (parsed.items.length > 0) {
    await db.insert(schema.lineItems).values(
      parsed.items.map((it) => ({
        receiptId: receipt.id,
        rawName: it.raw_name,
        quantity: it.quantity,
        unit: it.unit,
        price: it.price,
      })),
    );
  }

  return receipt;
}
