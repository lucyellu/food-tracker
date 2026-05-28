import { parseWithDeepSeek } from "./deepseek";
import { parseWithGemini, parseGeminiText } from "./gemini";
import type { ParsedReceipt } from "./schema";
import { extractTextWithGoogleVision } from "@/lib/ocr/google-vision";
import { parseTntPackedOrderEmail } from "@/lib/receipts/tnt-email";
import { parseUberEatsOrderText } from "@/lib/receipts/uber-eats";

export type ParseInput =
  | { kind: "text"; text: string }
  | { kind: "image"; bytes: Uint8Array; mimeType: string }
  | { kind: "pdf"; bytes: Uint8Array };

// Default to Gemini Flash for text — it's faster on structured extraction than
// DeepSeek for receipts with 30+ line items, and the free tier covers personal
// usage. DeepSeek stays available as a fallback if Gemini errors.
const USE_DEEPSEEK = process.env.PREFER_DEEPSEEK === "true";

async function parseTextReceipt(text: string): Promise<ParsedReceipt> {
  const tntReceipt = parseTntPackedOrderEmail(text);
  if (tntReceipt) return tntReceipt;

  const uberEatsReceipt = parseUberEatsOrderText(text);
  if (uberEatsReceipt) return uberEatsReceipt;

  if (USE_DEEPSEEK) {
    return parseWithDeepSeek(text);
  }
  try {
    return await parseGeminiText(text);
  } catch (e) {
    // Fall back to DeepSeek if Gemini errored (rate limit, network blip, etc.)
    // and we have a DeepSeek key configured.
    if (process.env.DEEPSEEK_API_KEY) {
      console.warn(
        "Gemini text parse failed, falling back to DeepSeek:",
        (e as Error).message,
      );
      return parseWithDeepSeek(text);
    }
    throw e;
  }
}

export async function parseReceipt(input: ParseInput): Promise<ParsedReceipt> {
  if (input.kind === "text") {
    return parseTextReceipt(input.text);
  }
  if (input.kind === "image") {
    try {
      const ocrText = await extractTextWithGoogleVision(input.bytes, input.mimeType);
      if (ocrText?.trim()) {
        const parsed = await parseTextReceipt(ocrText);
        if (parsed.is_receipt) return parsed;
      }
    } catch (e) {
      console.warn("Google Vision OCR pre-pass failed, falling back to Gemini vision:", (e as Error).message);
    }
    return parseWithGemini(input.bytes, input.mimeType);
  }
  return parseWithGemini(input.bytes, "application/pdf");
}

export { ParsedReceiptSchema, type ParsedReceipt } from "./schema";
