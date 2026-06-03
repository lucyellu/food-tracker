import { NextResponse } from "next/server";
import { getGooglePhotosStatus } from "@/lib/google/photos";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await getGooglePhotosStatus());
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      {
        configured: false,
        connected: false,
        email: null,
        error: msg.includes("Failed query")
          ? "Could not read Google Photos settings. Check TURSO_DATABASE_URL/TURSO_AUTH_TOKEN and run npm run db:push."
          : msg,
      },
      { status: 500 },
    );
  }
}
