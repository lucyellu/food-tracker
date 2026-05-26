"use client";

import { CheckCircle2, Mail, RefreshCw, Unplug } from "lucide-react";
import { useEffect, useState } from "react";

type GmailStatus = {
  configured: boolean;
  connected: boolean;
  email: string | null;
  query: string | null;
  error?: string;
};

type GmailMerchant = "all" | "tnt" | "pricesmart";

const GMAIL_MERCHANTS: Array<{ id: GmailMerchant; label: string }> = [
  { id: "all", label: "All" },
  { id: "tnt", label: "T&T" },
  { id: "pricesmart", label: "PriceSmart" },
];

const GMAIL_DAY_WINDOWS = [14, 30, 90, 365] as const;

export function SettingsGmailPanel() {
  const [status, setStatus] = useState<GmailStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [merchant, setMerchant] = useState<GmailMerchant>("all");
  const [days, setDays] = useState<number>(90);
  const [message, setMessage] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    const error = params.get("gmail_error");
    if (error) return error;
    return params.get("gmail") === "connected" ? "Google inbox connected." : null;
  });

  async function loadStatus() {
    const res = await fetch("/api/google/status");
    const data = (await res.json()) as GmailStatus;
    setStatus(data);
    if (data.error) setMessage(data.error);
  }

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadStatus();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, []);

  async function disconnect() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/google/disconnect", { method: "POST" });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) {
        setMessage(data.error ?? `Remove failed: ${res.status}`);
        return;
      }
      await loadStatus();
      setMessage("Google inbox removed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not remove Google inbox.");
    } finally {
      setBusy(false);
    }
  }

  async function syncInbox(nextMerchant = merchant) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/google/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ maxResults: 25, merchant: nextMerchant, days }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? `Inbox sync failed: ${res.status}`);
        return;
      }
      setMessage(
        `Scanned ${data.scanned}, parsed ${data.parsed}, duplicates ${data.duplicates ?? 0}, skipped ${data.skipped}, failed ${data.failed}.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not process inbox.");
    } finally {
      setBusy(false);
    }
  }

  const connectedLabel = status?.email ? `Connected as ${status.email}` : "Connected";

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-semibold">Google inbox</h2>
          <p className="mt-1 max-w-2xl text-sm text-zinc-500 dark:text-zinc-400">
            Connect Gmail to find grocery receipt emails, then remove the connection here whenever you want.
          </p>
          <div className="mt-3 inline-flex max-w-full items-center gap-2 rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            {status?.connected ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <Mail className="h-3.5 w-3.5" />
            )}
            <span className="truncate">
              {status ? (status.connected ? connectedLabel : "Not connected") : "Checking connection..."}
            </span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:w-auto">
          {status?.connected ? (
            <button
              type="button"
              onClick={disconnect}
              disabled={busy}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-rose-200 px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-900 dark:text-rose-300 dark:hover:bg-rose-950/30"
            >
              <Unplug className="h-4 w-4" />
              Remove
            </button>
          ) : (
            <a
              href="/api/google/auth?returnTo=/settings"
              className={`inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium ${
                status?.configured
                  ? "bg-zinc-900 text-white hover:opacity-90 dark:bg-zinc-100 dark:text-zinc-900"
                  : "pointer-events-none border border-zinc-200 text-zinc-400 dark:border-zinc-800"
              }`}
            >
              <Mail className="h-4 w-4" />
              Connect
            </a>
          )}
          <button
            type="button"
            onClick={() => void loadStatus()}
            disabled={busy}
            className="inline-flex items-center justify-center gap-2 rounded-md border border-zinc-200 px-3 py-2 text-sm font-medium hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            <RefreshCw className="h-4 w-4" />
            Check
          </button>
        </div>
      </div>

      {status && !status.configured ? (
        <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
          Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and EMAIL_ENCRYPTION_KEY to enable Google inbox connection.
        </div>
      ) : null}

      {status?.query ? (
        <div className="mt-3 truncate text-xs text-zinc-500 dark:text-zinc-500">Search: {status.query}</div>
      ) : null}

      {status?.connected ? (
        <div className="mt-4 grid gap-3 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium uppercase text-zinc-500">Merchant</span>
            {GMAIL_MERCHANTS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setMerchant(option.id)}
                disabled={busy}
                className={`rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${
                  merchant === option.id
                    ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                    : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium uppercase text-zinc-500">Date</span>
            {GMAIL_DAY_WINDOWS.map((optionDays) => (
              <button
                key={optionDays}
                type="button"
                onClick={() => setDays(optionDays)}
                disabled={busy}
                className={`rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${
                  days === optionDays
                    ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                    : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800"
                }`}
              >
                {optionDays === 365 ? "1 year" : `${optionDays} days`}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void syncInbox()}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
            >
              <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
              Process inbox
            </button>
            {GMAIL_MERCHANTS.filter((option) => option.id !== "all").map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => void syncInbox(option.id)}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-md border border-zinc-200 px-3 py-2 text-sm font-medium hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:hover:bg-zinc-800"
              >
                Sync {option.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {message ? (
        <div className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-950">
          {message}
        </div>
      ) : null}
    </section>
  );
}
