import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { decryptSecret, encryptSecret } from "@/lib/security/encryption";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const REQUIRED_GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

export const GMAIL_SCOPES = [
  "openid",
  "email",
  REQUIRED_GMAIL_SCOPE,
] as const;

type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
};

type GoogleUserInfo = {
  email?: string;
  sub?: string;
};

function hasRequiredGmailScope(scope: string | null | undefined) {
  if (!scope) return true;
  return scope.split(/\s+/).includes(REQUIRED_GMAIL_SCOPE);
}

function ensureRequiredGmailScope(scope: string | null | undefined) {
  if (hasRequiredGmailScope(scope)) return;
  throw new Error(
    "Google connected without Gmail read permission. Remove the inbox connection, connect again, and approve Gmail access.",
  );
}

export function isGmailScopeError(message: string) {
  return /insufficient authentication scopes|gmail read permission/i.test(message);
}

export function getGoogleOAuthConfig(reqUrl: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI || new URL("/api/google/callback", reqUrl).toString();

  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set");
  }

  return { clientId, clientSecret, redirectUri };
}

export function buildGoogleAuthUrl(reqUrl: string, state: string) {
  const { clientId, redirectUri } = getGoogleOAuthConfig(reqUrl);
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GMAIL_SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("include_granted_scopes", "false");
  url.searchParams.set("prompt", "consent select_account");
  url.searchParams.set("state", state);
  return url;
}

export async function exchangeCodeForTokens(reqUrl: string, code: string) {
  const { clientId, clientSecret, redirectUri } = getGoogleOAuthConfig(reqUrl);
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  const data = (await res.json()) as GoogleTokenResponse;
  if (!res.ok || data.error || !data.access_token) {
    throw new Error(data.error_description || data.error || "Google token exchange failed");
  }
  ensureRequiredGmailScope(data.scope);
  if (!data.refresh_token) {
    throw new Error("Google did not return a refresh token. Reconnect with consent enabled.");
  }

  return data;
}

export async function refreshGoogleAccessToken(refreshToken: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set");
  }

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  });

  const data = (await res.json()) as GoogleTokenResponse;
  if (!res.ok || data.error || !data.access_token) {
    throw new Error(data.error_description || data.error || "Google token refresh failed");
  }
  ensureRequiredGmailScope(data.scope);

  return data.access_token;
}

export async function revokeGoogleToken(refreshToken: string) {
  const res = await fetch(GOOGLE_REVOKE_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: refreshToken }),
  });
  if (!res.ok) {
    throw new Error(`Google token revoke failed (${res.status})`);
  }
}

export async function fetchGoogleUserInfo(accessToken: string) {
  const res = await fetch(GOOGLE_USERINFO_URL, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  return (await res.json()) as GoogleUserInfo;
}

export async function saveGoogleConnection(tokens: GoogleTokenResponse, email: string | null) {
  if (!tokens.refresh_token) {
    throw new Error("Missing Google refresh token");
  }

  const query = process.env.GMAIL_RECEIPT_QUERY || "newer_than:90d (receipt OR order OR invoice)";
  const existing = email
    ? await db
        .select()
        .from(schema.emailAccounts)
        .where(and(eq(schema.emailAccounts.provider, "gmail_oauth"), eq(schema.emailAccounts.email, email)))
        .limit(1)
    : [];

  const accountValues = {
    provider: "gmail_oauth" as const,
    label: email,
    email,
    host: null,
    port: null,
    mailbox: "Gmail API",
    query,
    secretEncrypted: encryptSecret(tokens.refresh_token),
    enabled: true,
    updatedAt: new Date(),
  };

  if (existing[0]) {
    await db
      .update(schema.emailAccounts)
      .set(accountValues)
      .where(eq(schema.emailAccounts.id, existing[0].id));
  } else {
    await db.insert(schema.emailAccounts).values(accountValues);
  }

  await db
    .insert(schema.settings)
    .values({
      id: 1,
      emailEnabled: false,
      emailUsername: email,
      emailPasswordEncrypted: null,
      emailMailbox: query,
    })
    .onConflictDoUpdate({
      target: schema.settings.id,
      set: {
        emailEnabled: false,
        emailUsername: email,
        emailPasswordEncrypted: null,
        emailMailbox: query,
      },
    });
}

export async function getStoredGoogleConnection() {
  const [account] = await db
    .select()
    .from(schema.emailAccounts)
    .where(and(eq(schema.emailAccounts.provider, "gmail_oauth"), eq(schema.emailAccounts.enabled, true)))
    .limit(1);
  if (account?.enabled) {
    return {
      accountId: account.id,
      email: account.email,
      query: account.query || process.env.GMAIL_RECEIPT_QUERY || "newer_than:90d (receipt OR order OR invoice)",
      refreshToken: decryptSecret(account.secretEncrypted),
    };
  }

  const [settings] = await db.select().from(schema.settings).where(eq(schema.settings.id, 1)).limit(1);
  if (!settings?.emailEnabled || !settings.emailPasswordEncrypted) {
    return null;
  }

  return {
    accountId: null,
    email: settings.emailUsername,
    query: settings.emailMailbox || process.env.GMAIL_RECEIPT_QUERY || "newer_than:90d (receipt OR order OR invoice)",
    refreshToken: decryptSecret(settings.emailPasswordEncrypted),
  };
}

export async function disconnectGoogleConnection(accountId?: number | null) {
  const accounts = accountId
    ? await db.select().from(schema.emailAccounts).where(eq(schema.emailAccounts.id, accountId)).limit(1)
    : await db.select().from(schema.emailAccounts).where(eq(schema.emailAccounts.provider, "gmail_oauth"));

  for (const account of accounts) {
    if (account.provider !== "gmail_oauth") continue;
    try {
      await revokeGoogleToken(decryptSecret(account.secretEncrypted));
    } catch (error) {
      console.warn("Could not revoke Google token during disconnect:", error);
    }
    await db.delete(schema.emailAccounts).where(eq(schema.emailAccounts.id, account.id));
  }

  const [settings] = await db.select().from(schema.settings).where(eq(schema.settings.id, 1)).limit(1);
  if (settings?.emailPasswordEncrypted) {
    try {
      await revokeGoogleToken(decryptSecret(settings.emailPasswordEncrypted));
    } catch (error) {
      console.warn("Could not revoke Google token during disconnect:", error);
    }
  }

  await db
    .insert(schema.settings)
    .values({
      id: 1,
      emailEnabled: false,
      emailUsername: null,
      emailPasswordEncrypted: null,
    })
    .onConflictDoUpdate({
      target: schema.settings.id,
      set: {
        emailEnabled: false,
        emailUsername: null,
        emailPasswordEncrypted: null,
      },
    });
}
