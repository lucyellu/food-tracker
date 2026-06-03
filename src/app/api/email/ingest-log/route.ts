import { desc, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db/client";
import { isRateLimitError } from "@/lib/llm/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 75, 1), 200);
    const queryLimit = Math.min(limit * 3, 500);
    const rows = await db
      .select({
        id: schema.emailIngestLog.id,
        receivedAt: schema.emailIngestLog.receivedAt,
        fromAddress: schema.emailIngestLog.fromAddress,
        subject: schema.emailIngestLog.subject,
        messageId: schema.emailIngestLog.messageId,
        status: schema.emailIngestLog.status,
        receiptId: schema.emailIngestLog.receiptId,
        errorText: schema.emailIngestLog.errorText,
        accountEmail: schema.emailAccounts.email,
        provider: schema.emailAccounts.provider,
      })
      .from(schema.emailIngestLog)
      .leftJoin(schema.emailAccounts, eq(schema.emailAccounts.id, schema.emailIngestLog.emailAccountId))
      .orderBy(desc(schema.emailIngestLog.id))
      .limit(queryLimit);

    return NextResponse.json({
      rows: rows
        .filter((row) => row.status !== "failed" || !isRateLimitError(row.errorText))
        .slice(0, limit)
        .map((row) => ({
          ...row,
          receivedAt: row.receivedAt.toISOString(),
        })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
