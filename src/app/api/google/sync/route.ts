import { NextRequest, NextResponse } from "next/server";
import { processGmailMerchantInbox } from "@/lib/gmail/messages";
import { getGmailMerchantPreset, type GmailMerchantPresetId } from "@/lib/gmail/merchant-presets";
import { isGmailScopeError } from "@/lib/gmail/oauth";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      maxResults?: number;
      merchant?: GmailMerchantPresetId;
      days?: number;
    };
    const maxResults = Math.min(Math.max(body.maxResults ?? 10, 1), 25);
    const merchant = getGmailMerchantPreset(body.merchant).id;
    const days = Math.min(Math.max(Number(body.days) || 90, 1), 3650);
    const result = await processGmailMerchantInbox({ maxResults, merchant, days });
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("gmail sync error:", msg);
    const needsReconnect = isGmailScopeError(msg);
    return NextResponse.json({ error: msg, needsReconnect }, { status: needsReconnect ? 401 : 500 });
  }
}
