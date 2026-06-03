"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  TIME_ZONE_COOKIE,
  TIME_ZONE_MODE_COOKIE,
  TIME_ZONE_MODE_STORAGE_KEY,
  TIME_ZONE_STORAGE_KEY,
  isTimeZoneMode,
  isValidTimeZone,
} from "@/lib/timezone";

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

function readCookie(name: string) {
  if (typeof document === "undefined") return null;
  return (
    document.cookie
      .split("; ")
      .find((part) => part.startsWith(`${name}=`))
      ?.split("=")[1] ?? null
  );
}

function writeCookie(name: string, value: string) {
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;
}

function browserTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function TimezoneCookieSync() {
  const router = useRouter();

  useEffect(() => {
    const savedMode = window.localStorage.getItem(TIME_ZONE_MODE_STORAGE_KEY);
    const mode = isTimeZoneMode(savedMode) ? savedMode : "auto";
    const savedTimeZone = window.localStorage.getItem(TIME_ZONE_STORAGE_KEY);
    const detectedTimeZone = browserTimeZone();
    const nextTimeZone =
      mode === "manual" && isValidTimeZone(savedTimeZone) ? savedTimeZone : detectedTimeZone;

    if (!isValidTimeZone(nextTimeZone)) return;

    const currentMode = readCookie(TIME_ZONE_MODE_COOKIE);
    const currentTimeZone = readCookie(TIME_ZONE_COOKIE);
    const nextEncoded = encodeURIComponent(nextTimeZone);
    const modeChanged = currentMode !== mode;
    const timeZoneChanged = currentTimeZone !== nextEncoded;

    if (modeChanged) writeCookie(TIME_ZONE_MODE_COOKIE, mode);
    if (timeZoneChanged) writeCookie(TIME_ZONE_COOKIE, nextTimeZone);

    if (modeChanged || timeZoneChanged) router.refresh();
  }, [router]);

  return null;
}
