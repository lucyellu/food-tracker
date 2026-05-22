import { NextResponse } from "next/server";
import { getStoredGoogleConnection } from "@/lib/gmail/oauth";

export const runtime = "nodejs";

export async function GET() {
  const configured = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  if (!configured) {
    return NextResponse.json({
      configured,
      connected: false,
      email: null,
      query: null,
    });
  }

  try {
    const connection = await getStoredGoogleConnection();
    return NextResponse.json({
      configured,
      connected: Boolean(connection),
      email: connection?.email ?? null,
      query: connection?.query ?? null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      {
        configured,
        connected: false,
        email: null,
        query: null,
        error: msg.includes("Failed query")
          ? "Could not read Gmail settings. Check DATABASE_URL and run npm run db:push."
          : msg,
      },
      { status: 500 },
    );
  }
}
