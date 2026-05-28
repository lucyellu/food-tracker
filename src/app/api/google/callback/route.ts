import { NextRequest, NextResponse } from "next/server";
import {
  exchangeCodeForTokens,
  fetchGoogleUserInfo,
  saveGoogleConnection,
} from "@/lib/gmail/oauth";
import { completeGooglePhotosOAuth } from "@/lib/google/photos";

export const runtime = "nodejs";

function safeReturnTo(value: string | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

function redirectAfterOAuth(req: NextRequest, params: Record<string, string>) {
  const url = new URL(safeReturnTo(req.cookies.get("gmail_oauth_return_to")?.value), req.url);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const res = NextResponse.redirect(url);
  res.cookies.set("gmail_oauth_state", "", { path: "/", maxAge: 0 });
  res.cookies.set("gmail_oauth_return_to", "", { path: "/", maxAge: 0 });
  res.cookies.set("google_oauth_intent", "", { path: "/", maxAge: 0 });
  return res;
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const error = req.nextUrl.searchParams.get("error");
  const expectedState = req.cookies.get("gmail_oauth_state")?.value;
  const intent = req.cookies.get("google_oauth_intent")?.value;

  if (error) {
    return redirectAfterOAuth(req, { [intent === "photos" ? "photos_error" : "gmail_error"]: error });
  }
  if (!code || !state || !expectedState || state !== expectedState) {
    return redirectAfterOAuth(req, {
      [intent === "photos" ? "photos_error" : "gmail_error"]: "Invalid Google OAuth state",
    });
  }

  try {
    if (intent === "photos") {
      await completeGooglePhotosOAuth(req.url, code);
      return redirectAfterOAuth(req, { photos: "connected" });
    }

    const tokens = await exchangeCodeForTokens(req.url, code);
    const userInfo = await fetchGoogleUserInfo(tokens.access_token ?? "");
    await saveGoogleConnection(tokens, userInfo?.email ?? null);
    return redirectAfterOAuth(req, { gmail: "connected" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return redirectAfterOAuth(req, { [intent === "photos" ? "photos_error" : "gmail_error"]: msg });
  }
}
