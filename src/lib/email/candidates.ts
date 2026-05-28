import { simpleParser } from "mailparser";
import { parse as parseHtml } from "node-html-parser";
import type { ParseInput } from "@/lib/llm/parse";

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export type ReceiptCandidate = {
  id: string;
  label: string;
  input: ParseInput;
  rawInputRef: string;
  text?: string;
};

export type RawEmailCandidates = {
  fromAddress: string | null;
  subject: string | null;
  candidates: ReceiptCandidate[];
};

function textFromBuffer(buffer: Buffer, mimeType: string | undefined) {
  const decoded = buffer.toString("utf8");
  if (mimeType === "text/html") {
    return parseHtml(decoded).structuredText;
  }
  return decoded;
}

function textCandidate(
  id: string,
  label: string,
  text: string | null | undefined,
  referenceText?: string,
): ReceiptCandidate | null {
  const trimmed = text?.trim();
  if (!trimmed) return null;
  return {
    id,
    label,
    text: trimmed,
    rawInputRef: [referenceText, trimmed].filter(Boolean).join("\n\n"),
    input: { kind: "text", text: trimmed },
  };
}

function fileCandidate(
  id: string,
  label: string,
  buffer: Buffer,
  mimeType: string,
  referenceText?: string,
): ReceiptCandidate {
  const bytes = new Uint8Array(buffer);
  return {
    id,
    label,
    rawInputRef: [referenceText, `${label} (${buffer.byteLength} bytes, ${mimeType})`]
      .filter(Boolean)
      .join("\n\n"),
    input: mimeType === "application/pdf" ? { kind: "pdf", bytes } : { kind: "image", bytes, mimeType },
  };
}

function isImageContentType(contentType: string) {
  return contentType.startsWith("image/");
}

function referenceTextForParsedEmail(parsed: Awaited<ReturnType<typeof simpleParser>>) {
  return [
    `From: ${parsed.from?.text ?? ""}`,
    `Subject: ${parsed.subject ?? ""}`,
    `Date: ${parsed.date?.toISOString() ?? ""}`,
  ].join("\n");
}

function bodyTextForParsedEmail(parsed: Awaited<ReturnType<typeof simpleParser>>) {
  const htmlText = typeof parsed.html === "string" ? parseHtml(parsed.html).structuredText : "";
  return [
    referenceTextForParsedEmail(parsed),
    "",
    parsed.text,
    htmlText,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function candidatesFromRawEmail(source: Buffer): Promise<RawEmailCandidates> {
  const parsed = await simpleParser(source);
  const referenceText = referenceTextForParsedEmail(parsed);
  const candidates = [textCandidate("body", "email body", bodyTextForParsedEmail(parsed))].filter(
    (candidate): candidate is ReceiptCandidate => Boolean(candidate),
  );

  for (const [index, attachment] of parsed.attachments.entries()) {
    if (attachment.content.byteLength > MAX_ATTACHMENT_BYTES) continue;
    const label = attachment.filename || `attachment ${index + 1}`;
    const id = `attachment-${index + 1}`;

    if (attachment.contentType === "text/plain" || attachment.contentType === "text/html") {
      const candidate = textCandidate(id, label, textFromBuffer(attachment.content, attachment.contentType), referenceText);
      if (candidate) candidates.push(candidate);
    } else if (attachment.contentType === "application/pdf") {
      candidates.push(fileCandidate(id, label, attachment.content, "application/pdf", referenceText));
    } else if (isImageContentType(attachment.contentType)) {
      candidates.push(fileCandidate(id, label, attachment.content, attachment.contentType, referenceText));
    }
  }

  return {
    fromAddress: parsed.from?.text ?? null,
    subject: parsed.subject ?? null,
    candidates,
  };
}
