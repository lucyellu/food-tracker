import { NextRequest, NextResponse } from "next/server";
import { processGmailInbox } from "@/lib/gmail/messages";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { maxResults?: number };
    const maxResults = Math.min(Math.max(body.maxResults ?? 10, 1), 25);
    const result = await processGmailInbox(maxResults);
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("gmail sync error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
