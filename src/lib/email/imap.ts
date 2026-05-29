import { ImapFlow } from "imapflow";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { parseReceipt } from "@/lib/llm/parse";
import { conciseParseError, isRateLimitError } from "@/lib/llm/errors";
import { findDuplicateParsedReceipt } from "@/lib/receipts/dedupe";
import { resolveReceiptPurchasedDate } from "@/lib/receipts/dates";
import { persistParsedReceipt } from "@/lib/receipts/persist";
import {
  extractMerchantOrderKey,
  getGmailMerchantPreset,
  type GmailMerchantPresetId,
} from "@/lib/gmail/merchant-presets";
import { candidatesFromRawEmail, MAX_ATTACHMENT_BYTES } from "./candidates";

type ImapCredentials = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  mailbox: string;
};

type ImapAccountConnection = {
  accountId: number;
  email: string | null;
  host: string;
  port: number;
  mailbox: string;
  password: string;
};

export type EmailSyncResult = {
  accountId: number | null;
  accountEmail: string | null;
  provider: string;
  scanned: number;
  candidates: number;
  attachments: number;
  parsed: number;
  skipped: number;
  skippedNoCandidates: number;
  skippedNotReceipt: number;
  skippedPreviouslySeen: number;
  failed: number;
  duplicates: number;
  rateLimited: boolean;
  nextPageToken: string | null;
  resultSizeEstimate: number | null;
  query: string;
  merchant: string;
  days: number;
  receipts: Array<{ id: number; vendor: string | null; purchasedAt: string | null; total: number | null }>;
};

function createImapClient({ host, port, secure, user, password }: ImapCredentials) {
  return new ImapFlow({
    host,
    port,
    secure,
    auth: {
      user,
      pass: password,
    },
    clientInfo: {
      name: "Food Tracker",
      vendor: "Food Tracker",
    },
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 60_000,
    logger: false,
  });
}

export async function verifyImapCredentials(credentials: ImapCredentials) {
  const client = createImapClient(credentials);
  await client.connect();
  try {
    const lock = await client.getMailboxLock(credentials.mailbox, { readOnly: true });
    lock.release();
  } finally {
    await client.logout();
  }
}

function dateDaysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - Math.min(Math.max(Math.floor(days), 1), 3650));
  date.setHours(0, 0, 0, 0);
  return date;
}

function emptyResult(connection: ImapAccountConnection, merchant: GmailMerchantPresetId, days: number): EmailSyncResult {
  return {
    accountId: connection.accountId,
    accountEmail: connection.email,
    provider: "yahoo_imap",
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
    query: `${connection.mailbox} since ${dateDaysAgo(days).toISOString().slice(0, 10)}`,
    merchant,
    days,
    receipts: [],
  };
}

function matchesMerchant(text: string | undefined, merchant: GmailMerchantPresetId) {
  if (merchant === "all") return true;
  if (!text) return false;
  const preset = getGmailMerchantPreset(merchant);
  return preset.vendorPatterns.some((pattern) => pattern.test(text));
}

async function logEmailIngest(input: typeof schema.emailIngestLog.$inferInsert) {
  await db.insert(schema.emailIngestLog).values(input);
}

async function findPriorSkippedCandidate(messageId: string) {
  const [prior] = await db
    .select({
      status: schema.emailIngestLog.status,
      receiptId: schema.emailIngestLog.receiptId,
      errorText: schema.emailIngestLog.errorText,
    })
    .from(schema.emailIngestLog)
    .where(eq(schema.emailIngestLog.messageId, messageId))
    .orderBy(desc(schema.emailIngestLog.id))
    .limit(1);

  if (prior?.status !== "skipped_not_receipt") return null;
  const errorText = prior.errorText ?? "";
  const reusable =
    prior.receiptId != null ||
    /did not look like a receipt|No readable|No matching|Duplicate/i.test(errorText);
  return reusable ? prior : null;
}

function parseImapOffset(pageToken: string | null | undefined) {
  const offset = Number(pageToken);
  return Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0;
}

export async function processImapAccount(
  connection: ImapAccountConnection,
  {
    maxResults = 10,
    merchant = "all",
    days = 90,
    pageToken,
  }: {
    maxResults?: number;
    merchant?: GmailMerchantPresetId;
    days?: number;
    pageToken?: string | null;
  } = {},
) {
  const result = emptyResult(connection, merchant, days);
  const client = createImapClient({
    host: connection.host,
    port: connection.port,
    secure: true,
    user: connection.email ?? "",
    password: connection.password,
    mailbox: connection.mailbox,
  });

  await client.connect();
  try {
    const lock = await client.getMailboxLock(connection.mailbox, { readOnly: true });
    try {
      const uids = await client.search({ since: dateDaysAgo(days) }, { uid: true });
      const offset = parseImapOffset(pageToken);
      const sortedUids = (uids || []).sort((a, b) => b - a);
      result.resultSizeEstimate = sortedUids.length;
      const latestUids = sortedUids.slice(offset, offset + maxResults);
      result.nextPageToken = offset + maxResults < sortedUids.length ? String(offset + maxResults) : null;
      if (latestUids.length === 0) return result;

      for await (const message of client.fetch(
        latestUids,
        {
          uid: true,
          source: { maxLength: MAX_ATTACHMENT_BYTES + 1024 * 1024 },
          envelope: true,
          internalDate: true,
        },
        { uid: true },
      )) {
        result.scanned += 1;
        const baseMessageId = `email:${connection.accountId}:imap:${connection.mailbox}:${message.uid}`;
        try {
          if (!message.source) {
            result.skipped += 1;
            result.skippedNoCandidates += 1;
            await logEmailIngest({
              emailAccountId: connection.accountId,
              messageId: baseMessageId,
              fromAddress: message.envelope?.from?.map((from) => from.address).filter(Boolean).join(", ") ?? null,
              subject: message.envelope?.subject ?? null,
              status: "skipped_not_receipt",
              errorText: "No readable IMAP message source found",
            });
            continue;
          }

          const parsedEmail = await candidatesFromRawEmail(message.source);
          const candidates = parsedEmail.candidates.filter((candidate) => matchesMerchant(candidate.text, merchant));
          result.candidates += candidates.length;
          result.attachments += candidates.filter((candidate) => candidate.id !== "body").length;

          if (candidates.length === 0) {
            result.skipped += 1;
            result.skippedNoCandidates += 1;
            await logEmailIngest({
              emailAccountId: connection.accountId,
              fromAddress: parsedEmail.fromAddress,
              subject: parsedEmail.subject,
              messageId: baseMessageId,
              status: "skipped_not_receipt",
              errorText: "No matching readable receipt body or supported attachment found",
            });
            continue;
          }

          let parsedAny = false;
          for (const candidate of candidates) {
            const candidateMessageId = candidate.id === "body" ? baseMessageId : `${baseMessageId}:${candidate.id}`;
            const [existing] = await db
              .select({ id: schema.receipts.id })
              .from(schema.receipts)
              .where(eq(schema.receipts.sourceMessageId, candidateMessageId))
              .limit(1);
            if (existing) {
              result.duplicates += 1;
              result.skipped += 1;
              await logEmailIngest({
                emailAccountId: connection.accountId,
                fromAddress: parsedEmail.fromAddress,
                subject: parsedEmail.subject,
                messageId: candidateMessageId,
                status: "skipped_not_receipt",
                errorText: `Duplicate email source ${candidateMessageId}`,
                receiptId: existing.id,
              });
              continue;
            }

            const priorSkipped = await findPriorSkippedCandidate(candidateMessageId);
            if (priorSkipped) {
              result.skipped += 1;
              if (priorSkipped.receiptId) result.duplicates += 1;
              else result.skippedPreviouslySeen += 1;
              continue;
            }

            const parsed = await parseReceipt(candidate.input);
            if (!parsed.is_receipt) {
              result.skipped += 1;
              result.skippedNotReceipt += 1;
              await logEmailIngest({
                emailAccountId: connection.accountId,
                fromAddress: parsedEmail.fromAddress,
                subject: parsedEmail.subject,
                messageId: candidateMessageId,
                status: "skipped_not_receipt",
                errorText: `${candidate.label} did not look like a receipt`,
              });
              continue;
            }

            const merchantOrderKey = candidate.text ? extractMerchantOrderKey(candidate.text, merchant) : null;
            const sourceMessageId = merchantOrderKey ?? candidateMessageId;
            if (merchantOrderKey) {
              const [existingOrder] = await db
                .select({ id: schema.receipts.id })
                .from(schema.receipts)
                .where(eq(schema.receipts.sourceMessageId, merchantOrderKey))
                .limit(1);
              if (existingOrder) {
                result.duplicates += 1;
                result.skipped += 1;
                await logEmailIngest({
                  emailAccountId: connection.accountId,
                  fromAddress: parsedEmail.fromAddress,
                  subject: parsedEmail.subject,
                  messageId: candidateMessageId,
                  status: "skipped_not_receipt",
                  errorText: `Duplicate merchant order ${merchantOrderKey}`,
                  receiptId: existingOrder.id,
                });
                continue;
              }
            }

            const purchasedAt = resolveReceiptPurchasedDate(parsed.purchased_at, candidate.rawInputRef);
            const duplicateReceipt = await findDuplicateParsedReceipt(parsed, purchasedAt);
            if (duplicateReceipt) {
              result.duplicates += 1;
              result.skipped += 1;
              await logEmailIngest({
                emailAccountId: connection.accountId,
                fromAddress: parsedEmail.fromAddress,
                subject: parsedEmail.subject,
                messageId: candidateMessageId,
                status: "skipped_not_receipt",
                errorText: `Duplicate receipt content for receipt ${duplicateReceipt.id}`,
                receiptId: duplicateReceipt.id,
              });
              continue;
            }

            const receipt = await persistParsedReceipt({
              parsed,
              source: "auto_email",
              rawInputKind: candidate.input.kind === "text" ? "email" : "image",
              rawInputRef: candidate.rawInputRef,
              sourceMessageId,
            });
            result.parsed += 1;
            parsedAny = true;
            result.receipts.push({
              id: receipt.id,
              vendor: receipt.vendor,
              purchasedAt: receipt.purchasedAt,
              total: receipt.total,
            });
            await logEmailIngest({
              emailAccountId: connection.accountId,
              fromAddress: parsedEmail.fromAddress,
              subject: parsedEmail.subject,
              messageId: candidateMessageId,
              status: "parsed",
              receiptId: receipt.id,
            });
            break;
          }

          if (!parsedAny && candidates.length > 0) {
            // Candidate-level skipped rows already record the reason.
          }
        } catch (error) {
          result.failed += 1;
          if (isRateLimitError(error)) result.rateLimited = true;
          await logEmailIngest({
            emailAccountId: connection.accountId,
            messageId: baseMessageId,
            fromAddress: message.envelope?.from?.map((from) => from.address).filter(Boolean).join(", ") ?? null,
            subject: message.envelope?.subject ?? null,
            status: "failed",
            errorText: conciseParseError(error),
          });
          if (isRateLimitError(error)) {
            result.nextPageToken = pageToken ?? null;
            break;
          }
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }

  return result;
}
