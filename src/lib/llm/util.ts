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

// Retry a flaky network call with exponential backoff. Bails immediately on
// real API errors (400 / 401 / 403) — only retries network / 5xx / 429.
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; baseDelayMs?: number; label?: string } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const baseDelay = opts.baseDelayMs ?? 1000;
  const label = opts.label ?? "request";
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const err = e as Error & { status?: number };
      // Auth / validation errors won't succeed on retry — bail immediately.
      if (
        typeof err.status === "number" &&
        err.status >= 400 &&
        err.status < 500 &&
        err.status !== 429
      ) {
        throw e;
      }
      if (i < attempts - 1) {
        const delay = baseDelay * Math.pow(2, i);
        console.warn(
          `${label} attempt ${i + 1}/${attempts} failed: ${err.message}; retrying in ${delay}ms`,
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}
