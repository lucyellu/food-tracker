import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  allowedEmails,
  authEnabled,
  createSessionToken,
} from "@/lib/auth/session";
import { authRedirectUri } from "@/lib/auth/redirect";

export const runtime = "nodejs";

function back(req: NextRequest, error: string) {
  const res = NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error)}`, req.url));
  res.cookies.set("ft_auth_state", "", { path: "/", maxAge: 0 });
  return res;
}

export async function GET(req: NextRequest) {
  if (!authEnabled()) return NextResponse.redirect(new URL("/", req.url));

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  if (req.nextUrl.searchParams.get("error")) return back(req, "Google sign-in was cancelled.");
  if (!code || !state || state !== req.cookies.get("ft_auth_state")?.value) {
    return back(req, "Sign-in expired. Try again.");
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      redirect_uri: authRedirectUri(req.url),
      grant_type: "authorization_code",
    }),
  });
  const tokens = (await tokenRes.json()) as { access_token?: string };
  if (!tokenRes.ok || !tokens.access_token) return back(req, "Google sign-in failed.");

  const infoRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { authorization: `Bearer ${tokens.access_token}` },
  });
  const info = (await infoRes.json()) as { email?: string; email_verified?: boolean };
  const email = info.email?.toLowerCase();
  if (!email || info.email_verified === false) return back(req, "Google did not return a verified email.");
  if (!allowedEmails().includes(email)) return back(req, "That Google account is not allowed to use this app.");

  const dest = req.cookies.get("ft_auth_return")?.value;
  const target = dest && dest.startsWith("/") && !dest.startsWith("//") ? dest : "/";
  const res = NextResponse.redirect(new URL(target, req.url));
  res.cookies.set(SESSION_COOKIE, await createSessionToken(email), {
    httpOnly: true,
    sameSite: "lax",
    secure: req.nextUrl.protocol === "https:",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  res.cookies.set("ft_auth_state", "", { path: "/", maxAge: 0 });
  res.cookies.set("ft_auth_return", "", { path: "/", maxAge: 0 });
  return res;
}
