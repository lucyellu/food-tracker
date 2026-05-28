import { NextRequest, NextResponse } from "next/server";
import { createGooglePhotosPickerSession } from "@/lib/google/photos";

export const runtime = "nodejs";

function durationToMs(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const seconds = Number(value.replace(/s$/, ""));
  return Number.isFinite(seconds) ? Math.max(Math.round(seconds * 1000), 1000) : fallback;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { maxItemCount?: number };
    const session = await createGooglePhotosPickerSession(body.maxItemCount ?? 10);
    return NextResponse.json({
      sessionId: session.id,
      pickerUri: session.pickerUri,
      pollIntervalMs: durationToMs(session.pollingConfig?.pollInterval, 3000),
      timeoutMs: durationToMs(session.pollingConfig?.timeoutIn, 300000),
      expireTime: session.expireTime,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
