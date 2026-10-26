"use client";

import { CheckCircle2, Cpu, ExternalLink, KeyRound, Mail, Pause, Play, RefreshCw, Search, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { EmailScanProgress } from "@/components/EmailScanProgress";
import { mainVendorMarks, VendorMark } from "@/components/VendorMark";
import { CollapsibleCard } from "./CollapsibleCard";

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
  parseEngine?: {
    proceduralVendors: string[];
    deepSeekConfigured: boolean;
    preferDeepSeek: boolean;
  };
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

type EmailLogRow = {
  id: number;
  receivedAt: string;
  fromAddress: string | null;
  subject: string | null;
  messageId: string | null;
  status: "parsed" | "skipped_not_receipt" | "failed";
  receiptId: number | null;
  errorText: string | null;
  accountEmail: string | null;
  provider: string | null;
};

type GmailMerchant = "all" | "tnt" | "costco" | "pricesmart" | "ubereats" | "dutchlove";
type ScanCursor = {
  key: string;
  accountId?: number;
  pageTokens: Record<string, string>;
  // Cumulative messages scanned so far for this scan key, and Gmail's estimate of
  // the total matching the query, so we can show "~N older matches left".
  scanned: number;
  estimate: number | null;
};
type AutoScanStats = {
  batches: number;
  scanned: number;
  parsed: number;
  duplicates: number;
  skipped: number;
  failed: number;
  remaining: number | null;
};

const GMAIL_MERCHANTS: Array<{ id: GmailMerchant; label: string }> = [
  { id: "all", label: "All" },
  { id: "tnt", label: "T&T" },
  { id: "costco", label: "Costco" },
  { id: "pricesmart", label: "PriceSmart" },
  { id: "ubereats", label: "Uber Eats" },
  { id: "dutchlove", label: "Dutch Love" },
];

const GMAIL_DAY_WINDOWS = [14, 30, 90, 365, 730, 3650] as const;
const GMAIL_BATCH_SIZE = 50;
const SCAN_CURSOR_STORAGE_KEY = "food-tracker:email-scan-cursors";
const SCAN_FILTER_STORAGE_KEY = "food-tracker:email-scan-filter";
const GMAIL_MERCHANT_IDS = new Set(GMAIL_MERCHANTS.map((option) => option.id));

type SavedScanFilter = {
  merchant: GmailMerchant;
  days: number;
};

function scanKey(merchant: GmailMerchant, days: number, accountId?: number) {
  return `${merchant}:${days}:${accountId ?? "all"}`;
}

function dayWindowLabel(days: number) {
  if (days === 365) return "1 year";
  if (days === 730) return "2 years";
  if (days === 3650) return "10 years";
  return `${days} days`;
}

function isGmailMerchant(value: unknown): value is GmailMerchant {
  return typeof value === "string" && GMAIL_MERCHANT_IDS.has(value as GmailMerchant);
}

function readJsonObject(key: string) {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function readSavedScanFilter(): SavedScanFilter | null {
  const saved = readJsonObject(SCAN_FILTER_STORAGE_KEY);
  if (!saved || !isGmailMerchant(saved.merchant) || typeof saved.days !== "number") return null;
  return { merchant: saved.merchant, days: saved.days };
}

function saveScanFilter(filter: SavedScanFilter) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SCAN_FILTER_STORAGE_KEY, JSON.stringify(filter));
}

function readSavedScanCursor(key: string): ScanCursor | null {
  const saved = readJsonObject(SCAN_CURSOR_STORAGE_KEY);
  const entry = saved?.[key];
  if (!entry || typeof entry !== "object") return null;
  const obj = entry as Record<string, unknown>;
  // New shape stores { pageTokens, scanned, estimate, accountId }; legacy stored the
  // pageTokens map directly (keys are account ids), so fall back to treating obj as it.
  const hasShape = "pageTokens" in obj && obj.pageTokens != null && typeof obj.pageTokens === "object";
  const pageTokens = (hasShape ? obj.pageTokens : obj) as Record<string, string>;
  if (!pageTokens || typeof pageTokens !== "object" || Object.keys(pageTokens).length === 0) return null;
  return {
    key,
    accountId: typeof obj.accountId === "number" ? obj.accountId : undefined,
    pageTokens,
    scanned: typeof obj.scanned === "number" ? obj.scanned : 0,
    estimate: typeof obj.estimate === "number" ? obj.estimate : null,
  };
}

function saveScanCursor(cursor: ScanCursor) {
  if (typeof window === "undefined") return;
  const saved = readJsonObject(SCAN_CURSOR_STORAGE_KEY) ?? {};
  saved[cursor.key] = {
    pageTokens: cursor.pageTokens,
    scanned: cursor.scanned,
    estimate: cursor.estimate,
    accountId: cursor.accountId,
  };
  window.localStorage.setItem(SCAN_CURSOR_STORAGE_KEY, JSON.stringify(saved));
}

function remainingFromCursor(cursor: ScanCursor | null) {
  if (!cursor || cursor.estimate == null) return null;
  return Math.max(0, cursor.estimate - cursor.scanned);
}

function clearSavedScanCursor(key: string) {
  if (typeof window === "undefined") return;
  const saved = readJsonObject(SCAN_CURSOR_STORAGE_KEY) ?? {};
  delete saved[key];
  window.localStorage.setItem(SCAN_CURSOR_STORAGE_KEY, JSON.stringify(saved));
}

function syncMessage(data: SyncResponse, remaining: number | null) {
  const accountErrors = data.accounts?.filter((account) => account.error) ?? [];
  const errorSuffix =
    accountErrors.length > 0
      ? ` ${accountErrors.length} inbox${accountErrors.length === 1 ? "" : "es"} need attention: ${accountErrors
          .map((account) => `${account.accountEmail ?? "inbox"} (${account.error})`)
          .join("; ")}`
      : "";
  const skipDetails = [
    data.skippedPreviouslySeen ? `${data.skippedPreviouslySeen} already ruled out` : null,
    data.skippedNotReceipt ? `${data.skippedNotReceipt} new non-receipts` : null,
    data.skippedNoCandidates ? `${data.skippedNoCandidates} without readable receipt content` : null,
  ].filter(Boolean);
  const details = skipDetails.length > 0 ? ` (${skipDetails.join(", ")})` : "";
  const rateLimit = data.rateLimited ? " Stopped early because the LLM quota/rate limit was hit." : "";
  const more = data.hasMore
    ? remaining != null
      ? ` ~${remaining.toLocaleString()} older match${remaining === 1 ? "" : "es"} left to scan.`
      : " Older matches are available."
    : " No older matches left.";
  return `Scanned ${data.scanned ?? 0}, checked ${data.candidates ?? 0} bodies/attachments (${
    data.attachments ?? 0
  } attachments), parsed ${data.parsed ?? 0}, duplicates ${data.duplicates ?? 0}, skipped ${
    data.skipped ?? 0
  }${details}, failed ${data.failed ?? 0}.${rateLimit}${more}${errorSuffix}`;
}

function autoScanMessage(
  stats: AutoScanStats,
  outcome: "running" | "paused" | "rate" | "done" | "error",
) {
  const base = `Auto-scan ${outcome === "running" ? "running" : "stopped"}: ${stats.batches} batch${
    stats.batches === 1 ? "" : "es"
  } of ${GMAIL_BATCH_SIZE}, scanned ${stats.scanned}, parsed ${stats.parsed}, duplicates ${
    stats.duplicates
  }, skipped ${stats.skipped}, failed ${stats.failed}.`;
  const remaining =
    outcome === "done" || stats.remaining == null
      ? ""
      : ` ~${stats.remaining.toLocaleString()} older match${stats.remaining === 1 ? "" : "es"} left.`;
  const tail =
    outcome === "rate"
      ? " Paused on rate limit — resume in a moment."
      : outcome === "paused"
        ? " Paused — resume anytime."
        : outcome === "done"
          ? " Done — reached the oldest matching email."
          : "";
  return `${base}${remaining}${tail}`;
}

function formatEmailDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function logStatusLabel(row: EmailLogRow) {
  if (row.status === "parsed") return "Parsed";
  if (row.status === "failed") return "Failed";
  if (row.receiptId) return "Duplicate";
  if (/did not look like a receipt/i.test(row.errorText ?? "")) return "Not receipt";
  if (/No readable|No matching/i.test(row.errorText ?? "")) return "No readable body";
  return "Skipped";
}

function logStatusClass(row: EmailLogRow) {
  if (row.status === "parsed") return "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300";
  if (row.status === "failed") return "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300";
  if (row.receiptId) return "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300";
  return "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300";
}

function EmailFoundPanel({
  rows,
  search,
  setSearch,
  refresh,
  loading,
}: {
  rows: EmailLogRow[];
  search: string;
  setSearch: (value: string) => void;
  refresh: () => void;
  loading: boolean;
}) {
  const query = search.trim().toLowerCase();
  const filteredRows = rows.filter((row) =>
    [row.fromAddress, row.subject, row.accountEmail, row.errorText]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(query),
  );

  return (
    <div className="mt-4 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-sm font-semibold">Found emails</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {mainVendorMarks().map((vendor) => (
              <VendorMark key={vendor.id} label={vendor.label} />
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Filter emails"
              className="h-9 w-52 rounded-md border border-zinc-200 bg-transparent pl-8 pr-3 text-sm outline-none focus:border-zinc-400 dark:border-zinc-800"
            />
          </div>
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-200 px-3 text-sm font-medium hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:hover:bg-zinc-800"
          >
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>
      <div className="mt-3 max-h-80 overflow-auto rounded-md border border-zinc-200 dark:border-zinc-800">
        <table className="w-full min-w-[780px] text-left text-sm">
          <thead className="sticky top-0 bg-zinc-50 text-xs uppercase text-zinc-500 dark:bg-zinc-900">
            <tr>
              <th className="px-3 py-2 font-medium">Vendor</th>
              <th className="px-3 py-2 font-medium">Email</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Inbox</th>
              <th className="px-3 py-2 font-medium">When</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row) => (
              <tr key={row.id} className="border-t border-zinc-100 dark:border-zinc-800">
                <td className="px-3 py-2">
                  <VendorMark text={`${row.fromAddress ?? ""} ${row.subject ?? ""}`} compact />
                </td>
                <td className="max-w-[340px] px-3 py-2">
                  <div className="truncate font-medium">{row.subject ?? "(no subject)"}</div>
                  <div className="truncate text-xs text-zinc-500">{row.fromAddress ?? "Unknown sender"}</div>
                  {row.errorText ? <div className="mt-1 truncate text-xs text-zinc-500">{row.errorText}</div> : null}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2 py-1 text-xs font-medium ${logStatusClass(row)}`}>
                      {logStatusLabel(row)}
                    </span>
                    {row.receiptId ? (
                      <a
                        href={`/receipts/${row.receiptId}`}
                        className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                      >
                        Receipt
                        <ExternalLink className="size-3" />
                      </a>
                    ) : null}
                  </div>
                </td>
                <td className="px-3 py-2 text-xs text-zinc-500">{row.accountEmail ?? row.provider ?? "Unknown"}</td>
                <td className="px-3 py-2 text-xs text-zinc-500">{formatEmailDate(row.receivedAt)}</td>
              </tr>
            ))}
            {filteredRows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-sm text-zinc-500">
                  No matching emails yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
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
  const [autoRunning, setAutoRunning] = useState(false);
  const [autoStats, setAutoStats] = useState<AutoScanStats | null>(null);
  const [pausing, setPausing] = useState(false);
  const pauseRef = useRef(false);
  const [emailLogs, setEmailLogs] = useState<EmailLogRow[]>([]);
  const [emailLogsLoading, setEmailLogsLoading] = useState(false);
  const [emailLogSearch, setEmailLogSearch] = useState("");

  async function loadStatus() {
    const res = await fetch("/api/google/status");
    const data = (await res.json()) as EmailStatus;
    setStatus(data);
    if (data.error) setMessage(data.error);
  }

  async function loadIngestLog() {
    setEmailLogsLoading(true);
    try {
      const res = await fetch("/api/email/ingest-log?limit=100");
      const data = (await res.json()) as { rows?: EmailLogRow[]; error?: string };
      if (res.ok) setEmailLogs(data.rows ?? []);
    } finally {
      setEmailLogsLoading(false);
    }
  }

  function updateScanFilter(nextMerchant = merchant, nextDays = days) {
    setMerchant(nextMerchant);
    setDays(nextDays);
    saveScanFilter({ merchant: nextMerchant, days: nextDays });
    setScanCursor(readSavedScanCursor(scanKey(nextMerchant, nextDays)));
    setAutoStats(null);
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
      const savedFilter = readSavedScanFilter();
      if (savedFilter) {
        setMerchant(savedFilter.merchant);
        setDays(savedFilter.days);
        setScanCursor(readSavedScanCursor(scanKey(savedFilter.merchant, savedFilter.days)));
      } else {
        setScanCursor(readSavedScanCursor(scanKey("all", 90)));
      }
      if (nextMessage) setMessage(nextMessage);
      void loadStatus();
      void loadIngestLog();
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

  // One Gmail/IMAP page fetch. Updates the saved cursor (tokens + cumulative scanned
  // + estimate) and returns the data so callers can chain batches or report results.
  async function performSync(opts: {
    nextMerchant: GmailMerchant;
    accountId?: number;
    pageTokens?: Record<string, string>;
    priorScanned: number;
  }): Promise<{
    data: SyncResponse;
    nextCursor: ScanCursor | null;
    cumulativeScanned: number;
    estimate: number | null;
  } | null> {
    const res = await fetch("/api/google/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        maxResults: GMAIL_BATCH_SIZE,
        merchant: opts.nextMerchant,
        days,
        accountId: opts.accountId,
        pageTokens: opts.pageTokens,
      }),
    });
    const data = (await res.json()) as SyncResponse;
    if (!res.ok) {
      setMessage(
        data.needsReconnect
          ? data.error ?? "Google needs to be reconnected with Gmail read permission."
          : data.error ?? `Inbox sync failed: ${res.status}`,
      );
      return null;
    }
    const key = scanKey(opts.nextMerchant, days, opts.accountId);
    const cumulativeScanned = opts.priorScanned + (data.scanned ?? 0);
    const estimate = data.resultSizeEstimate ?? null;
    const hasMore = Boolean(data.hasMore && data.pageTokens && Object.keys(data.pageTokens).length > 0);
    const nextCursor: ScanCursor | null = hasMore
      ? {
          key,
          accountId: opts.accountId,
          pageTokens: data.pageTokens as Record<string, string>,
          scanned: cumulativeScanned,
          estimate,
        }
      : null;
    if (nextCursor) saveScanCursor(nextCursor);
    else clearSavedScanCursor(key);
    setScanCursor(nextCursor);
    return { data, nextCursor, cumulativeScanned, estimate };
  }

  async function syncInbox(nextMerchant = merchant, accountId?: number, continueOlder = false) {
    setBusy(true);
    setSyncing(true);
    setMessage(null);
    setAutoStats(null);
    saveScanFilter({ merchant: nextMerchant, days });
    const key = scanKey(nextMerchant, days, accountId);
    const resume = continueOlder && scanCursor?.key === key ? scanCursor : null;
    try {
      const out = await performSync({
        nextMerchant,
        accountId,
        pageTokens: resume?.pageTokens,
        priorScanned: resume?.scanned ?? 0,
      });
      if (out) {
        const remaining =
          out.estimate != null ? Math.max(0, out.estimate - out.cumulativeScanned) : null;
        setMessage(`${continueOlder ? "Older batch — " : ""}${syncMessage(out.data, remaining)}`);
      }
      await loadIngestLog();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not process inbox.");
    } finally {
      setSyncing(false);
      setBusy(false);
    }
  }

  // Walks batch-by-batch through every matching email (e.g. the full 10-year window),
  // 50 at a time, until it runs out, hits a rate limit, or the user pauses.
  async function startAutoScan(nextMerchant = merchant, accountId?: number) {
    pauseRef.current = false;
    setPausing(false);
    setBusy(true);
    setSyncing(true);
    setAutoRunning(true);
    setMessage(null);
    saveScanFilter({ merchant: nextMerchant, days });
    const key = scanKey(nextMerchant, days, accountId);
    // Resume from a saved cursor for this exact filter, otherwise start from the newest page.
    const resume = scanCursor?.key === key ? scanCursor : null;
    let pageTokens = resume?.pageTokens;
    let priorScanned = resume?.scanned ?? 0;
    const stats: AutoScanStats = {
      batches: 0,
      scanned: priorScanned,
      parsed: 0,
      duplicates: 0,
      skipped: 0,
      failed: 0,
      remaining: remainingFromCursor(resume),
    };
    setAutoStats({ ...stats });
    try {
      while (true) {
        const out = await performSync({ nextMerchant, accountId, pageTokens, priorScanned });
        if (!out) break; // error already surfaced by performSync
        stats.batches += 1;
        stats.scanned = out.cumulativeScanned;
        stats.parsed += out.data.parsed ?? 0;
        stats.duplicates += out.data.duplicates ?? 0;
        stats.skipped += out.data.skipped ?? 0;
        stats.failed += out.data.failed ?? 0;
        stats.remaining = out.estimate != null ? Math.max(0, out.estimate - out.cumulativeScanned) : null;
        setAutoStats({ ...stats });
        await loadIngestLog();

        if (out.data.rateLimited) {
          setMessage(autoScanMessage(stats, "rate"));
          break;
        }
        if (!out.nextCursor) {
          setMessage(autoScanMessage(stats, "done"));
          break;
        }
        if (pauseRef.current) {
          setMessage(autoScanMessage(stats, "paused"));
          break;
        }
        setMessage(autoScanMessage(stats, "running"));
        pageTokens = out.nextCursor.pageTokens;
        priorScanned = out.cumulativeScanned;
      }
    } catch (error) {
      setMessage(
        `${error instanceof Error ? error.message : "Auto-scan stopped."} ${autoScanMessage(stats, "error")}`,
      );
    } finally {
      setAutoRunning(false);
      setSyncing(false);
      setBusy(false);
      setPausing(false);
    }
  }

  function pauseAutoScan() {
    pauseRef.current = true;
    setPausing(true);
    setMessage("Finishing the current batch, then pausing…");
  }

  const accounts = status?.accounts ?? [];

  return (
    <CollapsibleCard title="Inbox parser">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="mt-1 max-w-2xl text-sm text-zinc-500 dark:text-zinc-400">
            Connect Gmail or Yahoo inboxes and turn purchase emails into reusable inventory records.
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
        <div className="mt-4 overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
          <table className="w-full min-w-[510px] text-sm">
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
                        className="inline-flex h-9 items-center gap-1 rounded-md border border-zinc-200 px-2 text-xs font-medium hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:hover:bg-zinc-800"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        Sync
                      </button>
                      <button
                        type="button"
                        onClick={() => void removeAccount(account.id)}
                        disabled={busy}
                        className="inline-flex h-9 items-center gap-1 rounded-md border border-rose-200 px-2 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-900 dark:text-rose-300 dark:hover:bg-rose-950/30"
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
              onClick={() => updateScanFilter(option.id, days)}
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
              onClick={() => updateScanFilter(merchant, optionDays)}
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
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void syncInbox()}
            disabled={busy || accounts.length === 0}
            className="inline-flex items-center gap-2 rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            <RefreshCw className={`h-4 w-4 ${busy && !autoRunning ? "animate-spin" : ""}`} />
            Scan {GMAIL_BATCH_SIZE}
          </button>
          {autoRunning ? (
            <button
              type="button"
              onClick={pauseAutoScan}
              disabled={pausing}
              className="inline-flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300"
            >
              <Pause className="h-4 w-4" />
              Pause
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void startAutoScan()}
              disabled={busy || accounts.length === 0}
              className="inline-flex items-center gap-2 rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              <Play className="h-4 w-4" />
              {scanCursor ? "Continue auto-scan" : `Auto-scan all (${dayWindowLabel(days)})`}
            </button>
          )}
          {scanCursor && !autoRunning ? (
            <button
              type="button"
              onClick={() => void syncInbox(merchant, scanCursor.accountId, true)}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-md border border-zinc-200 px-3 py-2 text-sm font-medium hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:hover:bg-zinc-800"
            >
              <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
              Scan next {GMAIL_BATCH_SIZE}
              {remainingFromCursor(scanCursor) != null
                ? ` (~${remainingFromCursor(scanCursor)!.toLocaleString()} left)`
                : ""}
            </button>
          ) : null}
        </div>
      </div>

      {status?.parseEngine ? (
        <div className="mt-4 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
          <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
            <Cpu className="h-4 w-4" />
            Parse path
            <span className="rounded-full bg-zinc-100 px-2 py-1 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              {status.parseEngine.preferDeepSeek
                ? "DeepSeek preferred"
                : status.parseEngine.deepSeekConfigured
                  ? "DeepSeek fallback ready"
                  : "Gemini fallback"}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-zinc-500">
            {status.parseEngine.proceduralVendors.map((vendor) => (
              <span key={vendor} className="rounded-full bg-zinc-100 px-2 py-1 dark:bg-zinc-800">
                {vendor} procedural
              </span>
            ))}
          </div>
        </div>
      ) : null}

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
          <EmailScanProgress
            label={autoRunning ? "Auto-scanning inboxes…" : "Scanning inboxes…"}
            detail={
              autoStats
                ? `Batch ${autoStats.batches} · ${autoStats.scanned.toLocaleString()} scanned, ${autoStats.parsed} parsed${
                    autoStats.remaining != null
                      ? ` · ~${autoStats.remaining.toLocaleString()} left`
                      : ""
                  }`
                : scanCursor?.estimate != null
                  ? `~${remainingFromCursor(scanCursor)?.toLocaleString() ?? "?"} emails left to scan`
                  : "Reading messages, attachments, and likely receipt bodies."
            }
            progress={
              autoStats?.remaining != null && autoStats.scanned + autoStats.remaining > 0
                ? autoStats.scanned / (autoStats.scanned + autoStats.remaining)
                : null
            }
          />
        </div>
      ) : null}

      {message ? (
        <div className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-950">
          {message}
        </div>
      ) : null}

      <EmailFoundPanel
        rows={emailLogs}
        search={emailLogSearch}
        setSearch={setEmailLogSearch}
        refresh={() => void loadIngestLog()}
        loading={emailLogsLoading}
      />
    </CollapsibleCard>
  );
}
