import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { authEnabled } from "@/lib/auth/session";
import { authRedirectUri } from "@/lib/auth/redirect";

export const runtime = "nodejs";

function safeReturnTo(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

export async function GET(req: NextRequest) {
  if (!authEnabled()) return NextResponse.redirect(new URL("/", req.url));
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return NextResponse.json({ error: "GOOGLE_CLIENT_ID is not set" }, { status: 500 });

  const state = randomBytes(24).toString("base64url");
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", authRedirectUri(req.url));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email");
  url.searchParams.set("prompt", "select_account");
  url.searchParams.set("state", state);

  const res = NextResponse.redirect(url);
  const cookie = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: req.nextUrl.protocol === "https:",
    path: "/",
    maxAge: 600,
  };
  res.cookies.set("ft_auth_state", state, cookie);
  res.cookies.set("ft_auth_return", safeReturnTo(req.nextUrl.searchParams.get("returnTo")), cookie);
  return res;
}
