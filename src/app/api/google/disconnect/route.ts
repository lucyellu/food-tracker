import { NextResponse } from "next/server";
import { disconnectGoogleConnection } from "@/lib/gmail/oauth";

export const runtime = "nodejs";

export async function POST() {
  try {
    await disconnectGoogleConnection();
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
