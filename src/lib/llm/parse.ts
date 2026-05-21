import { parseWithDeepSeek } from "./deepseek";
import { parseWithGemini } from "./gemini";
import type { ParsedReceipt } from "./schema";

export type ParseInput =
  | { kind: "text"; text: string }
  | { kind: "image"; bytes: Uint8Array; mimeType: string }
  | { kind: "pdf"; bytes: Uint8Array };

export async function parseReceipt(input: ParseInput): Promise<ParsedReceipt> {
  if (input.kind === "text") {
    return parseWithDeepSeek(input.text);
  }
  if (input.kind === "image") {
    return parseWithGemini(input.bytes, input.mimeType);
  }
  return parseWithGemini(input.bytes, "application/pdf");
}

export { ParsedReceiptSchema, type ParsedReceipt } from "./schema";
