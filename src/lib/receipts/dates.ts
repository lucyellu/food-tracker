const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function isoDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

function parseExplicitDate(value: string) {
  const iso = value.match(/\b((?:19|20)\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (iso) return isoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const monthName = value.match(
    /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?[,]?\s+((?:19|20)\d{2})\b/i,
  );
  if (monthName) {
    const month = MONTHS[monthName[1].toLowerCase().replace(".", "")];
    if (month) return isoDate(Number(monthName[3]), month, Number(monthName[2]));
  }

  const slash = value.match(/\b(\d{1,2})[/-](\d{1,2})[/-]((?:19|20)?\d{2})\b/);
  if (slash) {
    const year = slash[3].length === 2 ? 2000 + Number(slash[3]) : Number(slash[3]);
    const first = Number(slash[1]);
    const second = Number(slash[2]);
    if (first > 12) return isoDate(year, second, first);
    return isoDate(year, first, second);
  }

  return null;
}

function parseEmailDateHeader(line: string) {
  if (!/^date\s*:/i.test(line)) return null;
  const value = line.replace(/^date\s*:/i, "").trim();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

export function normalizeReceiptDate(value: string | null | undefined) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return parseExplicitDate(value);
}

export function inferPurchasedDateFromText(text: string | null | undefined) {
  if (!text?.trim()) return null;

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const receiptLines = lines.filter((line) => !/^date\s*:/i.test(line));

  const preferredLines = receiptLines.filter((line) =>
    /\b(order(?:ed)?|purchase(?:d)?|transaction|receipt|delivery|date|time|placed)\b/i.test(line),
  );
  for (const line of preferredLines) {
    const parsed = parseExplicitDate(line);
    if (parsed) return parsed;
  }

  for (const line of receiptLines) {
    const parsed = parseExplicitDate(line);
    if (parsed) return parsed;
  }

  for (const line of lines) {
    const emailDate = parseEmailDateHeader(line);
    if (emailDate) return emailDate;
  }

  return null;
}

export function resolveReceiptPurchasedDate(
  parsedPurchasedAt: string | null | undefined,
  rawInputRef: string | null | undefined,
) {
  return normalizeReceiptDate(parsedPurchasedAt) ?? inferPurchasedDateFromText(rawInputRef);
}
