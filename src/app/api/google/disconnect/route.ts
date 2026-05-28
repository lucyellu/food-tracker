import { NextRequest, NextResponse } from "next/server";
import { disconnectGoogleConnection } from "@/lib/gmail/oauth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { accountId?: number };
    const accountId = Number(body.accountId);
    await disconnectGoogleConnection(Number.isFinite(accountId) ? accountId : null);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
