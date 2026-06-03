import { NextRequest, NextResponse } from "next/server";
import { revalidateFoodDataCache } from "@/lib/food-data-cache";
import { importGooglePhotosPickerSession } from "@/lib/google/photos";

export const runtime = "nodejs";
export const maxDuration = 120;

function durationToMs(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const seconds = Number(value.replace(/s$/, ""));
  return Number.isFinite(seconds) ? Math.max(Math.round(seconds * 1000), 1000) : fallback;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { sessionId?: string };
    if (!body.sessionId) {
      return NextResponse.json({ error: "Missing Google Photos session id" }, { status: 400 });
    }

    const result = await importGooglePhotosPickerSession(body.sessionId);
    if (!result.ready) {
      return NextResponse.json(
        {
          ready: false,
          pollIntervalMs: durationToMs(result.session?.pollingConfig?.pollInterval, 3000),
          timeoutMs: durationToMs(result.session?.pollingConfig?.timeoutIn, 300000),
        },
        { status: 409 },
      );
    }

    revalidateFoodDataCache();
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
