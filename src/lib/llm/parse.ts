import { parseWithDeepSeek } from "./deepseek";
import { parseWithGemini, parseGeminiText } from "./gemini";
import type { ParsedReceipt } from "./schema";
import {
  extractTextWithGoogleVision,
  isGoogleVisionOcrConfigured,
} from "@/lib/ocr/google-vision";
import { parsePriceSmartOrderText } from "@/lib/receipts/pricesmart";
import { parseTntPackedOrderEmail } from "@/lib/receipts/tnt-email";
import { parseUberEatsOrderText } from "@/lib/receipts/uber-eats";

export type ParseInput =
  | { kind: "text"; text: string }
  | { kind: "image"; bytes: Uint8Array; mimeType: string }
  | { kind: "pdf"; bytes: Uint8Array };

// Text path: default to Gemini Flash (faster on 30+ line items, free tier covers
// personal use), with DeepSeek as a fallback if Gemini errors. Image path: Google
// Cloud Vision OCR → text parser (no Gemini vision). PDF path: Gemini vision.
const USE_DEEPSEEK = process.env.PREFER_DEEPSEEK === "true";

async function parseTextReceipt(text: string): Promise<ParsedReceipt> {
  const tntReceipt = parseTntPackedOrderEmail(text);
  if (tntReceipt) return tntReceipt;

  const priceSmartReceipt = parsePriceSmartOrderText(text);
  if (priceSmartReceipt) return priceSmartReceipt;

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
    // Images go through Google Cloud Vision OCR, then the text parser — no Gemini
    // vision. The OCR'd text is handed to the same text path (DeepSeek/Gemini-text)
    // that handles email bodies.
    if (!isGoogleVisionOcrConfigured()) {
      throw new Error(
        "GOOGLE_CLOUD_VISION_API_KEY is not set — image receipts need Cloud Vision OCR.",
      );
    }
    const ocrText = await extractTextWithGoogleVision(input.bytes, input.mimeType);
    if (!ocrText?.trim()) {
      throw new Error("Google Vision OCR returned no text for this image.");
    }
    return parseTextReceipt(ocrText);
  }
  // PDFs can't be OCR'd inline by the Vision sync API, so they still use Gemini.
  return parseWithGemini(input.bytes, "application/pdf");
}

export { ParsedReceiptSchema, type ParsedReceipt } from "./schema";
