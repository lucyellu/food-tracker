import { ParsedReceiptSchema, type ParsedReceipt } from "./schema";

export function tryParseReceipt(
  raw: string,
): { ok: true; value: ParsedReceipt } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    return { ok: false, error: `JSON parse error: ${(e as Error).message}` };
  }
  const result = ParsedReceiptSchema.safeParse(json);
  if (!result.success) {
    return { ok: false, error: `Schema validation: ${result.error.message}` };
  }
  return { ok: true, value: result.data };
}

// Trim and collapse repeated blank lines — keeps the LLM focused on real content,
// drops Gmail forwarding whitespace artifacts. Conservative; no semantic stripping.
export function compressWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
