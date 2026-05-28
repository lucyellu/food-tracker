import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { decryptSecret, encryptSecret } from "@/lib/security/encryption";
import { revokeGoogleToken } from "@/lib/gmail/oauth";
import { verifyImapCredentials } from "./imap";

export const DEFAULT_EMAIL_QUERY = "newer_than:90d (receipt OR order OR invoice)";
export const YAHOO_IMAP_HOST = "imap.mail.yahoo.com";
export const YAHOO_IMAP_PORT = 993;

export type EmailProvider = typeof schema.emailAccounts.$inferSelect.provider;
export type EmailAccountRow = typeof schema.emailAccounts.$inferSelect;

export type EmailAccountSummary = {
  id: number;
  provider: EmailProvider;
  providerLabel: string;
  label: string | null;
  email: string | null;
  host: string | null;
  port: number | null;
  mailbox: string;
  enabled: boolean;
  createdAt: string;
};

export function providerLabel(provider: EmailProvider) {
  if (provider === "gmail_oauth") return "Gmail";
  if (provider === "yahoo_imap") return "Yahoo Mail";
  return provider;
}

export function summarizeEmailAccount(account: EmailAccountRow): EmailAccountSummary {
  return {
    id: account.id,
    provider: account.provider,
    providerLabel: providerLabel(account.provider),
    label: account.label,
    email: account.email,
    host: account.host,
    port: account.port,
    mailbox: account.mailbox,
    enabled: account.enabled,
    createdAt: account.createdAt.toISOString(),
  };
}

async function migrateLegacyGoogleConnection() {
  const [settings] = await db.select().from(schema.settings).where(eq(schema.settings.id, 1)).limit(1);
  if (!settings?.emailEnabled || !settings.emailPasswordEncrypted) return;

  const existing = settings.emailUsername
    ? await db
        .select({ id: schema.emailAccounts.id })
        .from(schema.emailAccounts)
        .where(and(eq(schema.emailAccounts.provider, "gmail_oauth"), eq(schema.emailAccounts.email, settings.emailUsername)))
        .limit(1)
    : [];

  if (existing.length === 0) {
    await db.insert(schema.emailAccounts).values({
      provider: "gmail_oauth",
      label: settings.emailUsername,
      email: settings.emailUsername,
      mailbox: "Gmail API",
      query: settings.emailMailbox || process.env.GMAIL_RECEIPT_QUERY || DEFAULT_EMAIL_QUERY,
      secretEncrypted: settings.emailPasswordEncrypted,
      enabled: true,
    });
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

export async function listEmailAccounts() {
  await migrateLegacyGoogleConnection();
  return db.select().from(schema.emailAccounts).orderBy(asc(schema.emailAccounts.provider), asc(schema.emailAccounts.email));
}

export async function listActiveEmailAccounts() {
  const accounts = await listEmailAccounts();
  return accounts.filter((account) => account.enabled);
}

export async function getEmailAccount(id: number) {
  const [account] = await db.select().from(schema.emailAccounts).where(eq(schema.emailAccounts.id, id)).limit(1);
  return account ?? null;
}

export function decryptEmailAccountSecret(account: Pick<EmailAccountRow, "secretEncrypted">) {
  return decryptSecret(account.secretEncrypted);
}

export async function saveGmailAccount(refreshToken: string, email: string | null, query = DEFAULT_EMAIL_QUERY) {
  const existing = email
    ? await db
        .select()
        .from(schema.emailAccounts)
        .where(and(eq(schema.emailAccounts.provider, "gmail_oauth"), eq(schema.emailAccounts.email, email)))
        .limit(1)
    : [];

  const values = {
    provider: "gmail_oauth" as const,
    label: email,
    email,
    host: null,
    port: null,
    mailbox: "Gmail API",
    query,
    secretEncrypted: encryptSecret(refreshToken),
    enabled: true,
    updatedAt: new Date(),
  };

  if (existing[0]?.provider === "gmail_oauth") {
    const [updated] = await db
      .update(schema.emailAccounts)
      .set(values)
      .where(eq(schema.emailAccounts.id, existing[0].id))
      .returning();
    return updated;
  }

  const [created] = await db.insert(schema.emailAccounts).values(values).returning();
  return created;
}

export async function saveYahooImapAccount({
  email,
  password,
  mailbox = "INBOX",
}: {
  email: string;
  password: string;
  mailbox?: string;
}) {
  const normalizedEmail = email.trim();
  const normalizedMailbox = mailbox.trim() || "INBOX";
  await verifyImapCredentials({
    host: YAHOO_IMAP_HOST,
    port: YAHOO_IMAP_PORT,
    secure: true,
    user: normalizedEmail,
    password,
    mailbox: normalizedMailbox,
  });

  const existing = await db
    .select()
    .from(schema.emailAccounts)
    .where(and(eq(schema.emailAccounts.provider, "yahoo_imap"), eq(schema.emailAccounts.email, normalizedEmail)))
    .limit(1);

  const values = {
    provider: "yahoo_imap" as const,
    label: normalizedEmail,
    email: normalizedEmail,
    host: YAHOO_IMAP_HOST,
    port: YAHOO_IMAP_PORT,
    mailbox: normalizedMailbox,
    query: null,
    secretEncrypted: encryptSecret(password),
    enabled: true,
    updatedAt: new Date(),
  };

  if (existing[0]?.provider === "yahoo_imap") {
    const [updated] = await db
      .update(schema.emailAccounts)
      .set(values)
      .where(eq(schema.emailAccounts.id, existing[0].id))
      .returning();
    return updated;
  }

  const [created] = await db.insert(schema.emailAccounts).values(values).returning();
  return created;
}

export async function deleteEmailAccount(id: number) {
  const account = await getEmailAccount(id);
  if (!account) return null;

  if (account.provider === "gmail_oauth") {
    try {
      await revokeGoogleToken(decryptEmailAccountSecret(account));
    } catch (error) {
      console.warn("Could not revoke Google token during account removal:", error);
    }
  }

  await db.delete(schema.emailAccounts).where(eq(schema.emailAccounts.id, id));
  return account;
}
