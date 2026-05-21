import { NextResponse } from "next/server";
import { desc, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";

export const runtime = "nodejs";

export async function GET() {
  const rows = await db
    .select({
      id: schema.receipts.id,
      vendor: schema.receipts.vendor,
      purchasedAt: schema.receipts.purchasedAt,
      total: schema.receipts.total,
      source: schema.receipts.source,
      createdAt: schema.receipts.createdAt,
      itemCount: sql<number>`COUNT(${schema.lineItems.id})`.as("item_count"),
    })
    .from(schema.receipts)
    .leftJoin(schema.lineItems, sql`${schema.lineItems.receiptId} = ${schema.receipts.id}`)
    .groupBy(schema.receipts.id)
    .orderBy(desc(schema.receipts.createdAt));

  return NextResponse.json({ receipts: rows });
}
