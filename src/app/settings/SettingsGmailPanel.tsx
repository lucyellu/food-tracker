"use client";

import { CheckCircle2, KeyRound, Mail, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { EmailScanProgress } from "@/components/EmailScanProgress";

type EmailAccount = {
  id: number;
  provider: "gmail_oauth" | "yahoo_imap";
  providerLabel: string;
  label: string | null;
  email: string | null;
  host: string | null;
  port: number | null;
  mailbox: string;
  enabled: boolean;
  createdAt: string;
};

type EmailStatus = {
  configured: boolean;
  connected: boolean;
  email: string | null;
  query: string | null;
  accounts: EmailAccount[];
  error?: string;
};

type SyncResponse = {
  scanned?: number;
  candidates?: number;
  attachments?: number;
  parsed?: number;
  duplicates?: number;
  skipped?: number;
  skippedNoCandidates?: number;
  skippedNotReceipt?: number;
  skippedPreviouslySeen?: number;
  failed?: number;
  rateLimited?: boolean;
  hasMore?: boolean;
  pageTokens?: Record<string, string>;
  resultSizeEstimate?: number | null;
  accounts?: Array<{
    accountId?: number | null;
    accountEmail: string | null;
    provider: string;
    error?: string;
    rateLimited?: boolean;
    nextPageToken?: string | null;
    resultSizeEstimate?: number | null;
  }>;
  error?: string;
  needsReconnect?: boolean;
};

type GmailMerchant = "all" | "tnt" | "pricesmart" | "ubereats";
type ScanCursor = {
  key: string;
  accountId?: number;
  pageTokens: Record<string, string>;
};

const GMAIL_MERCHANTS: Array<{ id: GmailMerchant; label: string }> = [
  { id: "all", label: "All" },
  { id: "tnt", label: "T&T" },
  { id: "pricesmart", label: "PriceSmart" },
  { id: "ubereats", label: "Uber Eats" },
];

const GMAIL_DAY_WINDOWS = [14, 30, 90, 365, 730, 3650] as const;
const GMAIL_BATCH_SIZE = 50;

function scanKey(merchant: GmailMerchant, days: number, accountId?: number) {
  return `${merchant}:${days}:${accountId ?? "all"}`;
}

function dayWindowLabel(days: number) {
  if (days === 365) return "1 year";
  if (days === 730) return "2 years";
  if (days === 3650) return "10 years";
  return `${days} days`;
}

function syncMessage(data: SyncResponse) {
  const accountErrors = data.accounts?.filter((account) => account.error) ?? [];
  const errorSuffix =
    accountErrors.length > 0
      ? ` ${accountErrors.length} inbox${accountErrors.length === 1 ? "" : "es"} need attention.`
      : "";
  const skipDetails = [
    data.skippedPreviouslySeen ? `${data.skippedPreviouslySeen} already ruled out` : null,
    data.skippedNotReceipt ? `${data.skippedNotReceipt} new non-receipts` : null,
    data.skippedNoCandidates ? `${data.skippedNoCandidates} without readable receipt content` : null,
  ].filter(Boolean);
  const details = skipDetails.length > 0 ? ` (${skipDetails.join(", ")})` : "";
  const rateLimit = data.rateLimited ? " Stopped early because Gemini quota/rate limit was hit." : "";
  const more = data.hasMore ? " Older matches are available." : "";
  return `Scanned ${data.scanned ?? 0}, checked ${data.candidates ?? 0} bodies/attachments (${
    data.attachments ?? 0
  } attachments), parsed ${data.parsed ?? 0}, duplicates ${data.duplicates ?? 0}, skipped ${
    data.skipped ?? 0
  }${details}, failed ${data.failed ?? 0}.${rateLimit}${more}${errorSuffix}`;
}

export function SettingsGmailPanel() {
  const [status, setStatus] = useState<EmailStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [merchant, setMerchant] = useState<GmailMerchant>("all");
  const [days, setDays] = useState<number>(90);
  const [yahooEmail, setYahooEmail] = useState("");
  const [yahooPassword, setYahooPassword] = useState("");
  const [yahooMailbox, setYahooMailbox] = useState("INBOX");
  const [message, setMessage] = useState<string | null>(null);
  const [scanCursor, setScanCursor] = useState<ScanCursor | null>(null);

  async function loadStatus() {
    const res = await fetch("/api/google/status");
    const data = (await res.json()) as EmailStatus;
    setStatus(data);
    if (data.error) setMessage(data.error);
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get("gmail_error");
    const nextMessage = error
      ? error
      : params.get("gmail") === "connected"
        ? "Google inbox connected."
        : null;

    const timeoutId = window.setTimeout(() => {
      if (nextMessage) setMessage(nextMessage);
      void loadStatus();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, []);

  async function removeAccount(accountId: number) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/email/accounts/${accountId}`, { method: "DELETE" });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) {
        setMessage(data.error ?? `Remove failed: ${res.status}`);
        return;
      }
      await loadStatus();
      setMessage("Inbox removed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not remove inbox.");
    } finally {
      setBusy(false);
    }
  }

  async function addYahooAccount() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/email/accounts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: "yahoo_imap",
          email: yahooEmail,
          password: yahooPassword,
          mailbox: yahooMailbox,
        }),
      });
      const data = (await res.json()) as { account?: EmailAccount; error?: string };
      if (!res.ok) {
        setMessage(data.error ?? `Yahoo connection failed: ${res.status}`);
        return;
      }
      setYahooPassword("");
      await loadStatus();
      setMessage(`${data.account?.email ?? "Yahoo inbox"} connected.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not connect Yahoo inbox.");
    } finally {
      setBusy(false);
    }
  }

  async function syncInbox(nextMerchant = merchant, accountId?: number, continueOlder = false) {
    setBusy(true);
    setSyncing(true);
    setMessage(null);
    const key = scanKey(nextMerchant, days, accountId);
    const pageTokens = continueOlder && scanCursor?.key === key ? scanCursor.pageTokens : undefined;
    try {
      const res = await fetch("/api/google/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ maxResults: GMAIL_BATCH_SIZE, merchant: nextMerchant, days, accountId, pageTokens }),
      });
      const data = (await res.json()) as SyncResponse;
      if (!res.ok) {
        setMessage(
          data.needsReconnect
            ? data.error ?? "Google needs to be reconnected with Gmail read permission."
            : data.error ?? `Inbox sync failed: ${res.status}`,
        );
        return;
      }
      setMessage(`${continueOlder ? "Older batch: " : ""}${syncMessage(data)}`);
      setScanCursor(
        data.hasMore && data.pageTokens && Object.keys(data.pageTokens).length > 0
          ? { key, accountId, pageTokens: data.pageTokens }
          : null,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not process inbox.");
    } finally {
      setSyncing(false);
      setBusy(false);
    }
  }

  const accounts = status?.accounts ?? [];

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-semibold">Email inboxes</h2>
          <p className="mt-1 max-w-2xl text-sm text-zinc-500 dark:text-zinc-400">
            Connect Gmail or Yahoo inboxes for receipt imports.
          </p>
          <div className="mt-3 inline-flex max-w-full items-center gap-2 rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            {status?.connected ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <Mail className="h-3.5 w-3.5" />
            )}
            <span className="truncate">
              {status ? (accounts.length ? `${accounts.length} connected` : "Not connected") : "Checking connection..."}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href="/api/google/auth?returnTo=/settings"
            className={`inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium ${
              status?.configured
                ? "bg-zinc-900 text-white hover:opacity-90 dark:bg-zinc-100 dark:text-zinc-900"
                : "pointer-events-none border border-zinc-200 text-zinc-400 dark:border-zinc-800"
            }`}
          >
            <Mail className="h-4 w-4" />
            Add Gmail
          </a>
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

      {accounts.length > 0 ? (
        <div className="mt-4 overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-zinc-600 dark:bg-zinc-800/50 dark:text-zinc-400">
              <tr>
                <th className="px-3 py-2 font-medium">Inbox</th>
                <th className="px-3 py-2 font-medium">Provider</th>
                <th className="px-3 py-2 font-medium">Mailbox</th>
                <th className="px-3 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <tr key={account.id} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="px-3 py-2 font-medium">{account.email ?? account.label ?? "Unknown"}</td>
                  <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{account.providerLabel}</td>
                  <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{account.mailbox}</td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => void syncInbox(merchant, account.id)}
                        disabled={busy}
                        className="inline-flex items-center gap-1 rounded-md border border-zinc-200 px-2 py-1 text-xs font-medium hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:hover:bg-zinc-800"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        Sync
                      </button>
                      <button
                        type="button"
                        onClick={() => void removeAccount(account.id)}
                        disabled={busy}
                        className="inline-flex items-center gap-1 rounded-md border border-rose-200 px-2 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-900 dark:text-rose-300 dark:hover:bg-rose-950/30"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium uppercase text-zinc-500">Merchant</span>
              {GMAIL_MERCHANTS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => {
                setMerchant(option.id);
                setScanCursor(null);
              }}
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
              onClick={() => {
                setDays(optionDays);
                setScanCursor(null);
              }}
              disabled={busy}
              className={`rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${
                days === optionDays
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                  : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800"
              }`}
            >
              {dayWindowLabel(optionDays)}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void syncInbox()}
            disabled={busy || accounts.length === 0}
            className="inline-flex items-center gap-2 rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
            Sync all inboxes
          </button>
          {scanCursor ? (
            <button
              type="button"
              onClick={() => void syncInbox(merchant, scanCursor.accountId, true)}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-md border border-zinc-200 px-3 py-2 text-sm font-medium hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:hover:bg-zinc-800"
            >
              <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
              Scan next older batch
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-4 grid gap-3 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
        <div className="flex items-center gap-2 text-sm font-medium">
          <KeyRound className="h-4 w-4" />
          Add Yahoo
        </div>
        <div className="grid gap-2 md:grid-cols-[1fr_1fr_120px_auto]">
          <input
            type="email"
            value={yahooEmail}
            onChange={(event) => setYahooEmail(event.target.value)}
            placeholder="name@yahoo.com"
            disabled={busy}
            className="rounded-md border border-zinc-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-400 disabled:opacity-50 dark:border-zinc-800"
          />
          <input
            type="password"
            value={yahooPassword}
            onChange={(event) => setYahooPassword(event.target.value)}
            placeholder="App password"
            disabled={busy}
            className="rounded-md border border-zinc-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-400 disabled:opacity-50 dark:border-zinc-800"
          />
          <input
            type="text"
            value={yahooMailbox}
            onChange={(event) => setYahooMailbox(event.target.value)}
            placeholder="INBOX"
            disabled={busy}
            className="rounded-md border border-zinc-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-400 disabled:opacity-50 dark:border-zinc-800"
          />
          <button
            type="button"
            onClick={() => void addYahooAccount()}
            disabled={busy || !yahooEmail.trim() || !yahooPassword}
            className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            Connect
          </button>
        </div>
      </div>

      {syncing ? (
        <div className="mt-4">
          <EmailScanProgress />
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
