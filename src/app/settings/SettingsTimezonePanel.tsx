"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Clock } from "lucide-react";
import {
  COMMON_TIME_ZONES,
  TIME_ZONE_COOKIE,
  TIME_ZONE_MODE_COOKIE,
  TIME_ZONE_MODE_STORAGE_KEY,
  TIME_ZONE_STORAGE_KEY,
  type TimeZoneMode,
  isTimeZoneMode,
  isValidTimeZone,
} from "@/lib/timezone";
import { CollapsibleCard } from "./CollapsibleCard";

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

function writeCookie(name: string, value: string) {
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;
}

function detectedBrowserTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function SettingsTimezonePanel() {
  const router = useRouter();
  const [mode, setMode] = useState<TimeZoneMode>("auto");
  const [detectedTimeZone, setDetectedTimeZone] = useState<string | null>(null);
  const [manualTimeZone, setManualTimeZone] = useState("America/Vancouver");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const detected = detectedBrowserTimeZone();
      setDetectedTimeZone(detected);

      const savedMode = window.localStorage.getItem(TIME_ZONE_MODE_STORAGE_KEY);
      const nextMode = isTimeZoneMode(savedMode) ? savedMode : "auto";
      const savedTimeZone = window.localStorage.getItem(TIME_ZONE_STORAGE_KEY);
      setMode(nextMode);
      setManualTimeZone(isValidTimeZone(savedTimeZone) ? savedTimeZone : detected);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const options = useMemo(() => {
    const set = new Set<string>(COMMON_TIME_ZONES);
    if (detectedTimeZone) set.add(detectedTimeZone);
    if (manualTimeZone) set.add(manualTimeZone);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [detectedTimeZone, manualTimeZone]);

  function applyPreference(nextMode: TimeZoneMode, nextManualTimeZone = manualTimeZone) {
    const autoTimeZone = detectedTimeZone ?? detectedBrowserTimeZone();
    const nextTimeZone = nextMode === "manual" ? nextManualTimeZone : autoTimeZone;
    if (!isValidTimeZone(nextTimeZone)) {
      setMessage("Choose a valid timezone.");
      return;
    }

    setMode(nextMode);
    setManualTimeZone(nextTimeZone);
    window.localStorage.setItem(TIME_ZONE_MODE_STORAGE_KEY, nextMode);
    window.localStorage.setItem(TIME_ZONE_STORAGE_KEY, nextTimeZone);
    writeCookie(TIME_ZONE_MODE_COOKIE, nextMode);
    writeCookie(TIME_ZONE_COOKIE, nextTimeZone);
    setMessage(`Timezone set to ${nextTimeZone}.`);
    router.refresh();
  }

  const activeTimeZone = mode === "manual" ? manualTimeZone : detectedTimeZone;

  return (
    <CollapsibleCard title="Timezone" icon={<Clock className="size-4" />}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="mt-1 max-w-2xl text-sm text-zinc-500 dark:text-zinc-400">
            Used for Today, calendar highlighting, and day-based dashboard ranges.
          </p>
        </div>
        <div className="text-sm text-zinc-500">
          Active: <span className="font-medium text-zinc-900 dark:text-zinc-100">{activeTimeZone ?? "Detecting..."}</span>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => applyPreference("auto")}
          className={`rounded-md border px-3 py-2 text-sm font-medium ${
            mode === "auto"
              ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
              : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800"
          }`}
        >
          Auto
        </button>
        <button
          type="button"
          onClick={() => applyPreference("manual")}
          className={`rounded-md border px-3 py-2 text-sm font-medium ${
            mode === "manual"
              ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
              : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800"
          }`}
        >
          Manual
        </button>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(220px,360px)_auto] sm:items-center">
        <select
          value={manualTimeZone}
          onChange={(event) => {
            setManualTimeZone(event.target.value);
            if (mode === "manual") applyPreference("manual", event.target.value);
          }}
          disabled={mode !== "manual"}
          className="h-10 rounded-md border border-zinc-200 bg-transparent px-3 text-sm outline-none disabled:opacity-50 dark:border-zinc-800"
        >
          {options.map((timeZone) => (
            <option key={timeZone} value={timeZone}>
              {timeZone}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => applyPreference(mode)}
          className="h-10 rounded-md border border-zinc-200 px-3 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800"
        >
          Apply
        </button>
      </div>

      {message ? (
        <div className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
          {message}
        </div>
      ) : null}
    </CollapsibleCard>
  );
}
