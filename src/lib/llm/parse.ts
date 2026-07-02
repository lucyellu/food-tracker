import {
  isAiFreeConfigured,
  isAiFreeMediaConfigured,
  parseAiFreeText,
  parseWithAiFree,
} from "./ai-free";
import { parseWithDeepSeek } from "./deepseek";
import { parseWithGemini, parseGeminiText } from "./gemini";
import type { ParsedReceipt } from "./schema";
import { isRateLimitError } from "./errors";
import {
  extractTextWithGoogleVision,
  isGoogleVisionOcrConfigured,
} from "@/lib/ocr/google-vision";
import { reverseGoogleImageSearch } from "@/lib/products/reverse-image-search";
import { parsePriceSmartOrderText } from "@/lib/receipts/pricesmart";
import { parseTntPackedOrderEmail } from "@/lib/receipts/tnt-email";
import { parseUberEatsOrderText } from "@/lib/receipts/uber-eats";

export type ParseInput =
  | { kind: "text"; text: string }
  | { kind: "image"; bytes: Uint8Array; mimeType: string }
  | { kind: "pdf"; bytes: Uint8Array };

// Text path: procedural parsers first, then free OpenAI-compatible providers
// (Cerebras/Groq/local gateway), then Gemini Flash, with DeepSeek as an explicit
// preference or fallback. Image path: Google Cloud Vision OCR → text parser. PDF
// path: Gemini vision unless a local AI-free gateway explicitly handles media.
const USE_DEEPSEEK = process.env.PREFER_DEEPSEEK === "true";

// Circuit breaker: after a Gemini 429, skip Gemini for 60 s so the rest of the
// batch goes straight to DeepSeek instead of retrying Gemini on every email.
let geminiCircuitOpenUntil = 0;

function geminiCircuitOpen() {
  return Date.now() < geminiCircuitOpenUntil;
}

function tripGeminiCircuit() {
  geminiCircuitOpenUntil = Date.now() + 60_000;
  console.warn("Gemini rate-limited — routing to DeepSeek for 60 s");
}

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

  if (isAiFreeConfigured()) {
    try {
      return await parseAiFreeText(text);
    } catch (e) {
      console.warn("AI Free failed, falling back to Gemini/DeepSeek:", (e as Error).message);
    }
  }

  if (geminiCircuitOpen() && process.env.DEEPSEEK_API_KEY) {
    return parseWithDeepSeek(text);
  }

  try {
    return await parseGeminiText(text);
  } catch (e) {
    if (isRateLimitError(e)) tripGeminiCircuit();
    if (process.env.DEEPSEEK_API_KEY) {
      console.warn("Gemini failed, falling back to DeepSeek:", (e as Error).message);
      return parseWithDeepSeek(text);
    }
    throw e;
  }
}

async function parseImageReceipt(bytes: Uint8Array, mimeType: string): Promise<ParsedReceipt> {
  if (!isGoogleVisionOcrConfigured()) {
    throw new Error(
      "GOOGLE_CLOUD_VISION_API_KEY is not set — image receipts need Cloud Vision OCR.",
    );
  }

  const ocrText = (await extractTextWithGoogleVision(bytes, mimeType))?.trim() ?? "";
  let parsed: ParsedReceipt | null = null;

  if (ocrText) {
    parsed = await parseTextReceipt(ocrText);
    if (parsed.is_receipt) return parsed;
  }

  const reverse = await reverseGoogleImageSearch(bytes, mimeType);
  if (!reverse.fallbackText) {
    if (parsed) return parsed;
    throw new Error("Google Vision OCR returned no text for this image.");
  }

  const fallbackText = [
    ocrText ? `Visible OCR text:\n${ocrText}` : null,
    `Reverse image search fallback:\n${reverse.fallbackText}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  return parseTextReceipt(fallbackText);
}

export async function parseReceipt(input: ParseInput): Promise<ParsedReceipt> {
  if (input.kind === "text") {
    return parseTextReceipt(input.text);
  }
  if (input.kind === "image") {
    // Images go through Google Cloud Vision OCR, then the text parser. If OCR is
    // empty or the text parser rejects it, Vision Web Detection adds reverse-image
    // clues for bottle/can/product labels before retrying.
    return parseImageReceipt(input.bytes, input.mimeType);
  }
  // PDFs can't be OCR'd inline by the Vision sync API, so they still use Gemini.
  // If Gemini rate-limits, trip the circuit (so future text emails route to DeepSeek)
  // but surface a plain error so the batch scan doesn't stop.
  try {
    if (isAiFreeMediaConfigured("application/pdf")) {
      try {
        return await parseWithAiFree(input.bytes, "application/pdf");
      } catch (e) {
        console.warn("AI Free PDF parse failed, falling back to Gemini:", (e as Error).message);
      }
    }
    return await parseWithGemini(input.bytes, "application/pdf");
  } catch (e) {
    if (isRateLimitError(e)) {
      tripGeminiCircuit();
      throw new Error("PDF skipped: Gemini is rate-limited and PDFs have no text fallback.");
    }
    throw e;
  }
}

export { ParsedReceiptSchema, type ParsedReceipt } from "./schema";
