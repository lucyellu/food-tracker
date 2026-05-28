import { eq } from "drizzle-orm";
import { simpleParser } from "mailparser";
import { parse as parseHtml } from "node-html-parser";
import { db, schema } from "@/db/client";
import { parseReceipt, type ParseInput } from "@/lib/llm/parse";
import { persistParsedReceipt } from "@/lib/receipts/persist";
import {
  extractMerchantOrderKey,
  getGmailMerchantPreset,
  gmailQueryForPreset,
  type GmailMerchantPresetId,
} from "./merchant-presets";
import { getStoredGoogleConnection, isGmailScopeError, refreshGoogleAccessToken } from "./oauth";

const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const DEFAULT_QUERY = "newer_than:90d (receipt OR order OR invoice)";
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

type GmailListResponse = {
  messages?: Array<{ id: string; threadId: string }>;
  nextPageToken?: string;
  resultSizeEstimate?: number;
};

type GmailHeader = {
  name: string;
  value: string;
};

type GmailMessagePart = {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: {
    data?: string;
    attachmentId?: string;
    size?: number;
  };
  parts?: GmailMessagePart[];
};

type GmailMessage = {
  id: string;
  threadId: string;
  snippet?: string;
  payload?: GmailMessagePart;
};

type GmailAttachmentResponse = {
  data?: string;
  size?: number;
};

type ReceiptCandidate = {
  id: string;
  label: string;
  input: ParseInput;
  rawInputRef: string;
  text?: string;
};

export type GmailSyncResult = {
  accountId: number | null;
  accountEmail: string | null;
  provider: "gmail_oauth";
  scanned: number;
  candidates: number;
  attachments: number;
  parsed: number;
  skipped: number;
  failed: number;
  duplicates: number;
  query: string;
  merchant: string;
  days: number;
  receipts: Array<{ id: number; vendor: string | null; purchasedAt: string | null; total: number | null }>;
};

type GmailAccountConnection = {
  accountId: number | null;
  email: string | null;
  query: string | null;
  refreshToken: string;
};

async function gmailFetch<T>(path: string, accessToken: string, params?: Record<string, string>) {
  const url = new URL(`${GMAIL_API_BASE}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }

  const res = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (!res.ok) {
    const message =
      typeof data?.error?.message === "string" ? data.error.message : "Gmail API request failed";
    if (isGmailScopeError(message)) {
      throw new Error(
        "Google inbox connection is missing Gmail read permission. Remove it, connect again, choose the account, and approve Gmail access.",
      );
    }
    throw new Error(message);
  }
  return data as T;
}

function decodeBase64UrlBuffer(data: string) {
  return Buffer.from(data, "base64url");
}

function collectParts(part: GmailMessagePart | undefined, output: GmailMessagePart[] = []) {
  if (!part) return output;
  output.push(part);
  for (const child of part.parts ?? []) collectParts(child, output);
  return output;
}

function textFromPart(part: GmailMessagePart) {
  if (!part.body?.data) return null;
  return textFromBuffer(decodeBase64UrlBuffer(part.body.data), part.mimeType);
}

function textFromBuffer(buffer: Buffer, mimeType: string | undefined) {
  const decoded = buffer.toString("utf8");
  if (mimeType === "text/html") {
    return parseHtml(decoded).structuredText;
  }
  return decoded;
}

function getHeader(message: GmailMessage, name: string) {
  const headers = message.payload?.headers ?? [];
  return headers.find((header) => header.name.toLowerCase() === name.toLowerCase())?.value ?? null;
}

function extractMessageText(message: GmailMessage) {
  const parts = collectParts(message.payload);
  const plain = parts
    .filter((part) => part.mimeType === "text/plain")
    .map(textFromPart)
    .filter((text): text is string => Boolean(text?.trim()));
  const html = parts
    .filter((part) => part.mimeType === "text/html")
    .map(textFromPart)
    .filter((text): text is string => Boolean(text?.trim()));
  const body = [...plain, ...html, message.snippet].filter(Boolean).join("\n\n").trim();
  if (!body) return null;

  return [
    `From: ${getHeader(message, "From") ?? ""}`,
    `Subject: ${getHeader(message, "Subject") ?? ""}`,
    `Date: ${getHeader(message, "Date") ?? ""}`,
    "",
    body,
  ].join("\n");
}

function extensionFor(filename: string | undefined) {
  return filename?.split(".").pop()?.toLowerCase() ?? "";
}

function isForwardedEmail(part: GmailMessagePart) {
  const ext = extensionFor(part.filename);
  return part.mimeType === "message/rfc822" || ext === "eml";
}

function isTextAttachment(part: GmailMessagePart) {
  const ext = extensionFor(part.filename);
  return (
    part.mimeType === "text/plain" ||
    part.mimeType === "text/html" ||
    ext === "txt" ||
    ext === "html" ||
    ext === "htm"
  );
}

function isPdfAttachment(part: GmailMessagePart) {
  return part.mimeType === "application/pdf" || extensionFor(part.filename) === "pdf";
}

function isImageAttachment(part: GmailMessagePart) {
  const ext = extensionFor(part.filename);
  return (
    Boolean(part.mimeType?.startsWith("image/")) ||
    ["jpg", "jpeg", "png", "webp", "heic", "heif"].includes(ext)
  );
}

async function fetchPartBuffer(messageId: string, part: GmailMessagePart, accessToken: string) {
  if (part.body?.data) {
    return decodeBase64UrlBuffer(part.body.data);
  }
  if (!part.body?.attachmentId) return null;

  const attachment = await gmailFetch<GmailAttachmentResponse>(
    `/messages/${messageId}/attachments/${part.body.attachmentId}`,
    accessToken,
  );
  if (!attachment.data) return null;
  const buffer = decodeBase64UrlBuffer(attachment.data);
  if (buffer.byteLength > MAX_ATTACHMENT_BYTES) return null;
  return buffer;
}

function textCandidate(id: string, label: string, text: string | null | undefined): ReceiptCandidate | null {
  const trimmed = text?.trim();
  if (!trimmed) return null;
  return {
    id,
    label,
    text: trimmed,
    rawInputRef: trimmed,
    input: { kind: "text", text: trimmed },
  };
}

function fileCandidate(
  id: string,
  label: string,
  buffer: Buffer,
  mimeType: string,
): ReceiptCandidate {
  const bytes = new Uint8Array(buffer);
  return {
    id,
    label,
    rawInputRef: `${label} (${buffer.byteLength} bytes, ${mimeType})`,
    input:
      mimeType === "application/pdf"
        ? { kind: "pdf", bytes }
        : { kind: "image", bytes, mimeType },
  };
}

async function candidatesFromForwardedEmail(
  id: string,
  label: string,
  buffer: Buffer,
): Promise<ReceiptCandidate[]> {
  const parsed = await simpleParser(buffer);
  const htmlText = typeof parsed.html === "string" ? parseHtml(parsed.html).structuredText : "";
  const body = [
    `From: ${parsed.from?.text ?? ""}`,
    `Subject: ${parsed.subject ?? ""}`,
    `Date: ${parsed.date?.toISOString() ?? ""}`,
    "",
    parsed.text,
    htmlText,
  ]
    .filter(Boolean)
    .join("\n\n");
  const candidates = [textCandidate(`${id}:eml-body`, `${label} body`, body)].filter(
    (candidate): candidate is ReceiptCandidate => Boolean(candidate),
  );

  for (const [index, attachment] of parsed.attachments.entries()) {
    if (attachment.content.byteLength > MAX_ATTACHMENT_BYTES) continue;
    const attachmentLabel = attachment.filename || `${label} attachment ${index + 1}`;
    const attachmentId = `${id}:eml-attachment-${index + 1}`;
    if (attachment.contentType === "text/plain" || attachment.contentType === "text/html") {
      const text = textFromBuffer(attachment.content, attachment.contentType);
      const candidate = textCandidate(attachmentId, attachmentLabel, text);
      if (candidate) candidates.push(candidate);
    } else if (attachment.contentType === "application/pdf") {
      candidates.push(fileCandidate(attachmentId, attachmentLabel, attachment.content, "application/pdf"));
    } else if (attachment.contentType.startsWith("image/")) {
      candidates.push(fileCandidate(attachmentId, attachmentLabel, attachment.content, attachment.contentType));
    }
  }

  return candidates;
}

async function extractReceiptCandidates(message: GmailMessage, accessToken: string) {
  const candidates: ReceiptCandidate[] = [];
  const body = textCandidate("body", "email body", extractMessageText(message));
  if (body) candidates.push(body);

  const parts = collectParts(message.payload);
  for (const [index, part] of parts.entries()) {
    if (!part.filename && !part.body?.attachmentId) continue;
    if (!isForwardedEmail(part) && !isTextAttachment(part) && !isPdfAttachment(part) && !isImageAttachment(part)) {
      continue;
    }

    const buffer = await fetchPartBuffer(message.id, part, accessToken);
    if (!buffer) continue;

    const id = `attachment-${part.body?.attachmentId ?? part.partId ?? index}`;
    const label = part.filename || part.mimeType || `attachment ${index + 1}`;
    if (isForwardedEmail(part)) {
      candidates.push(...(await candidatesFromForwardedEmail(id, label, buffer)));
    } else if (isTextAttachment(part)) {
      const candidate = textCandidate(id, label, textFromBuffer(buffer, part.mimeType));
      if (candidate) candidates.push(candidate);
    } else if (isPdfAttachment(part)) {
      candidates.push(fileCandidate(id, label, buffer, "application/pdf"));
    } else if (isImageAttachment(part)) {
      candidates.push(fileCandidate(id, label, buffer, part.mimeType || "image/jpeg"));
    }
  }

  return candidates;
}

async function logEmailIngest(input: typeof schema.emailIngestLog.$inferInsert) {
  await db.insert(schema.emailIngestLog).values(input);
}

export async function processGmailInbox(maxResults = 10): Promise<GmailSyncResult> {
  return processGmailMerchantInbox({ maxResults });
}

export async function processGmailMerchantInbox({
  maxResults = 10,
  merchant = "all",
  days = 90,
}: {
  maxResults?: number;
  merchant?: GmailMerchantPresetId;
  days?: number;
} = {}): Promise<GmailSyncResult> {
  const connection = await getStoredGoogleConnection();
  if (!connection) {
    throw new Error("Gmail is not connected yet");
  }

  return processGmailAccount(connection, { maxResults, merchant, days });
}

function scopedGmailSourceId(connection: GmailAccountConnection, id: string) {
  return connection.accountId ? `email:${connection.accountId}:gmail:${id}` : id;
}

export async function processGmailAccount(
  connection: GmailAccountConnection,
  {
    maxResults = 10,
    merchant = "all",
    days = 90,
  }: {
    maxResults?: number;
    merchant?: GmailMerchantPresetId;
    days?: number;
  } = {},
): Promise<GmailSyncResult> {
  const accessToken = await refreshGoogleAccessToken(connection.refreshToken);
  const preset = getGmailMerchantPreset(merchant);
  const query = gmailQueryForPreset(preset.id, days);
  const list = await gmailFetch<GmailListResponse>("/messages", accessToken, {
    q: query || connection.query || DEFAULT_QUERY,
    maxResults: String(maxResults),
  });

  const result: GmailSyncResult = {
    accountId: connection.accountId,
    accountEmail: connection.email,
    provider: "gmail_oauth",
    scanned: 0,
    candidates: 0,
    attachments: 0,
    parsed: 0,
    skipped: 0,
    failed: 0,
    duplicates: 0,
    query: query || connection.query || DEFAULT_QUERY,
    merchant: preset.id,
    days,
    receipts: [],
  };

  for (const item of list.messages ?? []) {
    result.scanned += 1;

    let message: GmailMessage | null = null;
    try {
      message = await gmailFetch<GmailMessage>(`/messages/${item.id}`, accessToken, {
        format: "full",
      });
      const candidates = await extractReceiptCandidates(message, accessToken);
      result.candidates += candidates.length;
      result.attachments += candidates.filter((candidate) => candidate.id !== "body").length;
      if (candidates.length === 0) {
        result.skipped += 1;
        await logEmailIngest({
          emailAccountId: connection.accountId,
          fromAddress: getHeader(message, "From"),
          subject: getHeader(message, "Subject"),
          messageId: scopedGmailSourceId(connection, item.id),
          status: "skipped_not_receipt",
          errorText: "No readable email body or supported receipt attachment found",
        });
        continue;
      }

      let parsedAny = false;
      for (const candidate of candidates) {
        const rawCandidateMessageId =
          candidate.id === "body" ? item.id : `${item.id}:${candidate.id}`;
        const candidateMessageId = scopedGmailSourceId(connection, rawCandidateMessageId);
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
            fromAddress: getHeader(message, "From"),
            subject: getHeader(message, "Subject"),
            messageId: candidateMessageId,
            status: "skipped_not_receipt",
            errorText: `Duplicate Gmail source ${candidateMessageId}`,
            receiptId: existing.id,
          });
          continue;
        }

        const parsed = await parseReceipt(candidate.input);
        if (!parsed.is_receipt) {
          result.skipped += 1;
          await logEmailIngest({
            emailAccountId: connection.accountId,
            fromAddress: getHeader(message, "From"),
            subject: getHeader(message, "Subject"),
            messageId: candidateMessageId,
            status: "skipped_not_receipt",
            errorText: `${candidate.label} did not look like a receipt`,
          });
          continue;
        }

        const merchantOrderKey = candidate.text ? extractMerchantOrderKey(candidate.text, preset.id) : null;
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
              fromAddress: getHeader(message, "From"),
              subject: getHeader(message, "Subject"),
              messageId: candidateMessageId,
              status: "skipped_not_receipt",
              errorText: `Duplicate merchant order ${merchantOrderKey}`,
              receiptId: existingOrder.id,
            });
            continue;
          }
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
          fromAddress: getHeader(message, "From"),
          subject: getHeader(message, "Subject"),
          messageId: candidateMessageId,
          status: "parsed",
          receiptId: receipt.id,
        });
        break;
      }

      if (!parsedAny && candidates.length > 0) {
        // Candidate-level skipped/failed rows already record the reason.
      }
    } catch (e) {
      result.failed += 1;
      await logEmailIngest({
        emailAccountId: connection.accountId,
        fromAddress: message ? getHeader(message, "From") : null,
        subject: message ? getHeader(message, "Subject") : null,
        messageId: scopedGmailSourceId(connection, item.id),
        status: "failed",
        errorText: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return result;
}
