// Signed-cookie session for the optional "only my Google account" gate. Web Crypto only, so it runs in proxy.ts too.
export const SESSION_COOKIE = "ft_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export function authEnabled() {
  return Boolean(process.env.AUTH_SECRET);
}

export function allowedEmails() {
  return (process.env.APP_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

async function hmacKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

export async function createSessionToken(email: string) {
  const payload = toBase64Url(
    encoder.encode(JSON.stringify({ email, exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS })),
  );
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(), encoder.encode(payload));
  return `${payload}.${toBase64Url(new Uint8Array(sig))}`;
}

/** Returns the signed-in email, or null when the token is missing, forged, expired or no longer allowed. */
export async function verifySessionToken(token: string | undefined | null) {
  if (!token || !authEnabled()) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(), fromBase64Url(sig), encoder.encode(payload));
    if (!ok) return null;
    const data = JSON.parse(new TextDecoder().decode(fromBase64Url(payload))) as { email?: string; exp?: number };
    if (!data.email || !data.exp || data.exp < Date.now() / 1000) return null;
    if (!allowedEmails().includes(data.email.toLowerCase())) return null;
    return data.email;
  } catch {
    return null;
  }
}
