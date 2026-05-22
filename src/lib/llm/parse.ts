import { parseWithDeepSeek } from "./deepseek";
import { parseWithGemini, parseGeminiText } from "./gemini";
import type { ParsedReceipt } from "./schema";
import { parseTntPackedOrderEmail } from "@/lib/receipts/tnt-email";

export type ParseInput =
  | { kind: "text"; text: string }
  | { kind: "image"; bytes: Uint8Array; mimeType: string }
  | { kind: "pdf"; bytes: Uint8Array };

// Default to Gemini Flash for text — it's faster on structured extraction than
// DeepSeek for receipts with 30+ line items, and the free tier covers personal
// usage. DeepSeek stays available as a fallback if Gemini errors.
const USE_DEEPSEEK = process.env.PREFER_DEEPSEEK === "true";

export async function parseReceipt(input: ParseInput): Promise<ParsedReceipt> {
  if (input.kind === "text") {
    const tntReceipt = parseTntPackedOrderEmail(input.text);
    if (tntReceipt) return tntReceipt;

    if (USE_DEEPSEEK) {
      return parseWithDeepSeek(input.text);
    }
    try {
      return await parseGeminiText(input.text);
    } catch (e) {
      // Fall back to DeepSeek if Gemini errored (rate limit, network blip, etc.)
      // and we have a DeepSeek key configured.
      if (process.env.DEEPSEEK_API_KEY) {
        console.warn(
          "Gemini text parse failed, falling back to DeepSeek:",
          (e as Error).message,
        );
        return parseWithDeepSeek(input.text);
      }
      throw e;
    }
  }
  if (input.kind === "image") {
    return parseWithGemini(input.bytes, input.mimeType);
  }
  return parseWithGemini(input.bytes, "application/pdf");
}

export { ParsedReceiptSchema, type ParsedReceipt } from "./schema";
