import { decryptEmailAccountSecret, getEmailAccount, listActiveEmailAccounts } from "./accounts";
import { processImapAccount, type EmailSyncResult } from "./imap";
import { processGmailAccount } from "@/lib/gmail/messages";
import type { GmailMerchantPresetId } from "@/lib/gmail/merchant-presets";

export type MultiEmailSyncResult = Omit<
  EmailSyncResult,
  "accountId" | "accountEmail" | "provider" | "query"
> & {
  query: string;
  accounts: Array<
    Pick<
      EmailSyncResult,
      | "accountId"
      | "accountEmail"
      | "provider"
      | "scanned"
      | "candidates"
      | "attachments"
      | "parsed"
      | "skipped"
      | "failed"
      | "duplicates"
      | "query"
    > & { error?: string }
  >;
};

function emptyMultiResult(merchant: GmailMerchantPresetId, days: number): MultiEmailSyncResult {
  return {
    scanned: 0,
    candidates: 0,
    attachments: 0,
    parsed: 0,
    skipped: 0,
    failed: 0,
    duplicates: 0,
    query: "all enabled inboxes",
    merchant,
    days,
    receipts: [],
    accounts: [],
  };
}

function addAccountResult(target: MultiEmailSyncResult, source: EmailSyncResult) {
  target.scanned += source.scanned;
  target.candidates += source.candidates;
  target.attachments += source.attachments;
  target.parsed += source.parsed;
  target.skipped += source.skipped;
  target.failed += source.failed;
  target.duplicates += source.duplicates;
  target.receipts.push(...source.receipts);
  target.accounts.push({
    accountId: source.accountId,
    accountEmail: source.accountEmail,
    provider: source.provider,
    scanned: source.scanned,
    candidates: source.candidates,
    attachments: source.attachments,
    parsed: source.parsed,
    skipped: source.skipped,
    failed: source.failed,
    duplicates: source.duplicates,
    query: source.query,
  });
}

export async function processEmailInboxes({
  maxResults = 10,
  merchant = "all",
  days = 90,
  accountId,
}: {
  maxResults?: number;
  merchant?: GmailMerchantPresetId;
  days?: number;
  accountId?: number | null;
} = {}) {
  const accounts = accountId
    ? [await getEmailAccount(accountId)].filter(Boolean)
    : await listActiveEmailAccounts();

  if (accounts.length === 0) {
    throw new Error("No email inboxes are connected yet");
  }

  const result = emptyMultiResult(merchant, days);

  for (const account of accounts) {
    try {
      if (account.provider === "gmail_oauth") {
        addAccountResult(
          result,
          await processGmailAccount(
            {
              accountId: account.id,
              email: account.email,
              query: account.query,
              refreshToken: decryptEmailAccountSecret(account),
            },
            { maxResults, merchant, days },
          ),
        );
      } else if (account.provider === "yahoo_imap") {
        addAccountResult(
          result,
          await processImapAccount(
            {
              accountId: account.id,
              email: account.email,
              host: account.host ?? "imap.mail.yahoo.com",
              port: account.port ?? 993,
              mailbox: account.mailbox,
              password: decryptEmailAccountSecret(account),
            },
            { maxResults, merchant, days },
          ),
        );
      }
    } catch (error) {
      result.failed += 1;
      result.accounts.push({
        accountId: account.id,
        accountEmail: account.email,
        provider: account.provider,
        scanned: 0,
        candidates: 0,
        attachments: 0,
        parsed: 0,
        skipped: 0,
        failed: 1,
        duplicates: 0,
        query: account.query ?? account.mailbox,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  result.query = result.accounts.map((account) => `${account.accountEmail ?? account.provider}: ${account.query}`).join(" | ");
  return result;
}
