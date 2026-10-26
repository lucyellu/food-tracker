import "server-only";

import { cookies } from "next/headers";
import { TIME_ZONE_COOKIE, timeZoneFromCookie, todayIsoInTimeZone } from "@/lib/timezone";
import { daysBetween } from "./model";

// If receipts stopped arriving, show the pantry as it stood on the last
// receipt instead of an empty fridge.
const STALE_AFTER_DAYS = 14;

export async function getToday() {
  const cookieStore = await cookies();
  return todayIsoInTimeZone(timeZoneFromCookie(cookieStore.get(TIME_ZONE_COOKIE)?.value));
}

export function resolveAsOf(today: string, lastReceipt: string | null) {
  if (lastReceipt && lastReceipt < today && daysBetween(lastReceipt, today) > STALE_AFTER_DAYS) {
    return { asOf: lastReceipt, stale: true, staleDays: daysBetween(lastReceipt, today) };
  }
  return { asOf: today, stale: false, staleDays: 0 };
}
