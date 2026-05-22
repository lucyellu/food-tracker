import { eq } from "drizzle-orm";
import { parse as parseHtml } from "node-html-parser";
import { db, schema } from "@/db/client";
import { parseReceipt } from "@/lib/llm/parse";
import { persistParsedReceipt } from "@/lib/receipts/persist";
import { getStoredGoogleConnection, refreshGoogleAccessToken } from "./oauth";

const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const DEFAULT_QUERY = "newer_than:90d (receipt OR order OR invoice)";

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

export type GmailSyncResult = {
  scanned: number;
  parsed: number;
  skipped: number;
  failed: number;
  receipts: Array<{ id: number; vendor: string | null; purchasedAt: string | null; total: number | null }>;
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
    throw new Error(message);
  }
  return data as T;
}

function decodeBase64Url(data: string) {
  return Buffer.from(data, "base64url").toString("utf8");
}

function collectParts(part: GmailMessagePart | undefined, output: GmailMessagePart[] = []) {
  if (!part) return output;
  output.push(part);
  for (const child of part.parts ?? []) collectParts(child, output);
  return output;
}

function textFromPart(part: GmailMessagePart) {
  if (!part.body?.data) return null;
  const decoded = decodeBase64Url(part.body.data);
  if (part.mimeType === "text/html") {
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

async function logEmailIngest(input: typeof schema.emailIngestLog.$inferInsert) {
  await db.insert(schema.emailIngestLog).values(input);
}

export async function processGmailInbox(maxResults = 10): Promise<GmailSyncResult> {
  const connection = await getStoredGoogleConnection();
  if (!connection) {
    throw new Error("Gmail is not connected yet");
  }

  const accessToken = await refreshGoogleAccessToken(connection.refreshToken);
  const list = await gmailFetch<GmailListResponse>("/messages", accessToken, {
    q: connection.query || DEFAULT_QUERY,
    maxResults: String(maxResults),
  });

  const result: GmailSyncResult = {
    scanned: 0,
    parsed: 0,
    skipped: 0,
    failed: 0,
    receipts: [],
  };

  for (const item of list.messages ?? []) {
    result.scanned += 1;

    const [existing] = await db
      .select({ id: schema.receipts.id })
      .from(schema.receipts)
      .where(eq(schema.receipts.sourceMessageId, item.id))
      .limit(1);
    if (existing) {
      result.skipped += 1;
      continue;
    }

    let message: GmailMessage | null = null;
    try {
      message = await gmailFetch<GmailMessage>(`/messages/${item.id}`, accessToken, {
        format: "full",
      });
      const rawInputRef = extractMessageText(message);
      if (!rawInputRef) {
        result.skipped += 1;
        await logEmailIngest({
          fromAddress: getHeader(message, "From"),
          subject: getHeader(message, "Subject"),
          messageId: item.id,
          status: "skipped_not_receipt",
          errorText: "No readable email body found",
        });
        continue;
      }

      const parsed = await parseReceipt({ kind: "text", text: rawInputRef });
      if (!parsed.is_receipt) {
        result.skipped += 1;
        await logEmailIngest({
          fromAddress: getHeader(message, "From"),
          subject: getHeader(message, "Subject"),
          messageId: item.id,
          status: "skipped_not_receipt",
        });
        continue;
      }

      const receipt = await persistParsedReceipt({
        parsed,
        source: "auto_email",
        rawInputKind: "email",
        rawInputRef,
        sourceMessageId: item.id,
      });
      result.parsed += 1;
      result.receipts.push({
        id: receipt.id,
        vendor: receipt.vendor,
        purchasedAt: receipt.purchasedAt,
        total: receipt.total,
      });
      await logEmailIngest({
        fromAddress: getHeader(message, "From"),
        subject: getHeader(message, "Subject"),
        messageId: item.id,
        status: "parsed",
        receiptId: receipt.id,
      });
    } catch (e) {
      result.failed += 1;
      await logEmailIngest({
        fromAddress: message ? getHeader(message, "From") : null,
        subject: message ? getHeader(message, "Subject") : null,
        messageId: item.id,
        status: "failed",
        errorText: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return result;
}
