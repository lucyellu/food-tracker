import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { buildGooglePhotosAuthUrl } from "@/lib/google/photos";

export const runtime = "nodejs";

function safeReturnTo(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

export async function GET(req: NextRequest) {
  try {
    const state = randomBytes(24).toString("base64url");
    const returnTo = safeReturnTo(req.nextUrl.searchParams.get("returnTo"));
    const authUrl = buildGooglePhotosAuthUrl(req.url, state);
    const res = NextResponse.redirect(authUrl);
    res.cookies.set("gmail_oauth_state", state, {
      httpOnly: true,
      sameSite: "lax",
      secure: req.nextUrl.protocol === "https:",
      path: "/",
      maxAge: 10 * 60,
    });
    res.cookies.set("gmail_oauth_return_to", returnTo, {
      httpOnly: true,
      sameSite: "lax",
      secure: req.nextUrl.protocol === "https:",
      path: "/",
      maxAge: 10 * 60,
    });
    res.cookies.set("google_oauth_intent", "photos", {
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
