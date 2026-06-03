export const TIME_ZONE_COOKIE = "food_tracker_time_zone";
export const TIME_ZONE_MODE_COOKIE = "food_tracker_time_zone_mode";
export const TIME_ZONE_STORAGE_KEY = "food-tracker:time-zone";
export const TIME_ZONE_MODE_STORAGE_KEY = "food-tracker:time-zone-mode";
export const FALLBACK_TIME_ZONE = "UTC";

export type TimeZoneMode = "auto" | "manual";

export const COMMON_TIME_ZONES = [
  "America/Vancouver",
  "America/Los_Angeles",
  "America/Toronto",
  "America/New_York",
  "Europe/London",
  "Europe/Amsterdam",
  "UTC",
] as const;

export function isTimeZoneMode(value: unknown): value is TimeZoneMode {
  return value === "auto" || value === "manual";
}

export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function getRuntimeTimeZone(): string {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return isValidTimeZone(timeZone) ? timeZone : FALLBACK_TIME_ZONE;
}

export function normalizeTimeZone(value: unknown, fallback: string = getRuntimeTimeZone()) {
  return isValidTimeZone(value) ? value : fallback;
}

export function decodeCookieValue(value: string | undefined) {
  if (!value) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function timeZoneFromCookie(value: string | undefined) {
  return normalizeTimeZone(decodeCookieValue(value));
}

export function todayIsoInTimeZone(timeZone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: normalizeTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
