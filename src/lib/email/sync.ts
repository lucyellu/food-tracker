import { reconcileDuplicateReceipts } from "@/lib/receipts/reconcile";
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
      | "skippedNoCandidates"
      | "skippedNotReceipt"
      | "skippedPreviouslySeen"
      | "failed"
      | "duplicates"
      | "rateLimited"
      | "nextPageToken"
      | "resultSizeEstimate"
      | "query"
    > & { error?: string }
  >;
  hasMore: boolean;
  pageTokens: Record<string, string>;
};

function emptyMultiResult(merchant: GmailMerchantPresetId, days: number): MultiEmailSyncResult {
  return {
    scanned: 0,
    candidates: 0,
    attachments: 0,
    parsed: 0,
    skipped: 0,
    skippedNoCandidates: 0,
    skippedNotReceipt: 0,
    skippedPreviouslySeen: 0,
    failed: 0,
    duplicates: 0,
    rateLimited: false,
    nextPageToken: null,
    resultSizeEstimate: null,
    query: "all enabled inboxes",
    merchant,
    days,
    receipts: [],
    accounts: [],
    hasMore: false,
    pageTokens: {},
  };
}

function addAccountResult(target: MultiEmailSyncResult, source: EmailSyncResult) {
  target.scanned += source.scanned;
  target.candidates += source.candidates;
  target.attachments += source.attachments;
  target.parsed += source.parsed;
  target.skipped += source.skipped;
  target.skippedNoCandidates += source.skippedNoCandidates;
  target.skippedNotReceipt += source.skippedNotReceipt;
  target.skippedPreviouslySeen += source.skippedPreviouslySeen;
  target.failed += source.failed;
  target.duplicates += source.duplicates;
  target.rateLimited ||= source.rateLimited;
  target.resultSizeEstimate =
    source.resultSizeEstimate == null
      ? target.resultSizeEstimate
      : (target.resultSizeEstimate ?? 0) + source.resultSizeEstimate;
  if (source.nextPageToken && source.accountId != null) {
    target.hasMore = true;
    target.pageTokens[String(source.accountId)] = source.nextPageToken;
  }
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
    skippedNoCandidates: source.skippedNoCandidates,
    skippedNotReceipt: source.skippedNotReceipt,
    skippedPreviouslySeen: source.skippedPreviouslySeen,
    failed: source.failed,
    duplicates: source.duplicates,
    rateLimited: source.rateLimited,
    nextPageToken: source.nextPageToken,
    resultSizeEstimate: source.resultSizeEstimate,
    query: source.query,
  });
}

export async function processEmailInboxes({
  maxResults = 10,
  merchant = "all",
  days = 90,
  accountId,
  pageTokens,
}: {
  maxResults?: number;
  merchant?: GmailMerchantPresetId;
  days?: number;
  accountId?: number | null;
  pageTokens?: Record<string, string | null | undefined>;
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
            { maxResults, merchant, days, pageToken: pageTokens?.[String(account.id)] },
          ),
        );
        if (result.rateLimited) break;
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
            { maxResults, merchant, days, pageToken: pageTokens?.[String(account.id)] },
          ),
        );
        if (result.rateLimited) break;
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
        skippedNoCandidates: 0,
        skippedNotReceipt: 0,
        skippedPreviouslySeen: 0,
        failed: 1,
        duplicates: 0,
        rateLimited: false,
        nextPageToken: null,
        resultSizeEstimate: null,
        query: account.query ?? account.mailbox,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Merge the same trip arriving twice (order email + receipt, vendor parser + LLM parse).
  try {
    result.duplicates += (await reconcileDuplicateReceipts({ dryRun: false })).length;
  } catch (error) {
    console.error("receipt reconcile failed", error);
  }

  result.query = result.accounts.map((account) => `${account.accountEmail ?? account.provider}: ${account.query}`).join(" | ");
  return result;
}
