import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { buildGoogleAuthUrl } from "@/lib/gmail/oauth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const state = randomBytes(24).toString("base64url");
    const authUrl = buildGoogleAuthUrl(req.url, state);
    const res = NextResponse.redirect(authUrl);
    res.cookies.set("gmail_oauth_state", state, {
      httpOnly: true,
      sameSite: "lax",
      secure: req.nextUrl.protocol === "https:",
      path: "/",
      maxAge: 10 * 60,
    });
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
