import type { FoodKind, PantryEntry } from "./model";

export function tintVar(kind: FoodKind | string | null | undefined) {
  return `var(--tint-${kind ?? "pantry"})`;
}

export function formatDuration(days: number) {
  if (days <= 1) return "a day";
  if (days < 14) return `${Math.round(days)} days`;
  if (days < 60) return `${Math.round(days / 7)} weeks`;
  if (days < 365) return `${Math.round(days / 30)} months`;
  const years = days / 365;
  return years < 1.5 ? "a year" : `${Math.round(years)} years`;
}

export function leftLabel(entry: PantryEntry) {
  if (entry.finishedAt) return "marked used up";
  if (entry.remaining <= 0) return "used up";
  if (entry.daysLeft <= 1) return "last bits";
  return `~${formatDuration(entry.daysLeft)} left`;
}

export function lastsLabel(entry: PantryEntry) {
  return entry.lifetime.basis === "learned"
    ? `lasts you ~${formatDuration(entry.lifetime.days)}`
    : `usually ~${formatDuration(entry.lifetime.days)}`;
}

const SHORT_DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const LONG_DATE = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});
const YEAR_DATE = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function parseIso(date: string) {
  return new Date(`${date}T00:00:00Z`);
}

export function shortDate(date: string) {
  return SHORT_DATE.format(parseIso(date));
}

export function longDate(date: string) {
  return LONG_DATE.format(parseIso(date));
}

export function yearDate(date: string) {
  return YEAR_DATE.format(parseIso(date));
}

export function money(value: number | null | undefined) {
  // Some retailer emails omit line prices and the parser records 0.
  return value == null || value <= 0 ? "" : `$${value.toFixed(2)}`;
}
