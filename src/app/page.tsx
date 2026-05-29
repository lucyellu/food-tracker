"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Images, Mail, RefreshCw, Settings } from "lucide-react";
import { EmailScanProgress } from "@/components/EmailScanProgress";

type Mode = "text" | "email" | "image";
type GmailStatus = {
  configured: boolean;
  connected: boolean;
  email: string | null;
  query: string | null;
  accounts?: Array<{ id: number; email: string | null; providerLabel: string; mailbox: string }>;
  error?: string;
};
type GmailSyncError = {
  error?: string;
  needsReconnect?: boolean;
};
type GmailSyncResponse = {
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
};
type GmailMerchant = "all" | "tnt" | "pricesmart" | "ubereats";
type PhotosStatus = {
  configured: boolean;
  connected: boolean;
  email: string | null;
  error?: string;
};
type PhotosSessionResponse = {
  sessionId?: string;
  pickerUri?: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
  error?: string;
};
type PhotosImportResponse = {
  ready?: boolean;
  selected?: number;
  parsed?: number;
  duplicates?: number;
  skipped?: number;
  failed?: number;
  receipts?: Array<{ id: number }>;
  pollIntervalMs?: number;
  timeoutMs?: number;
  error?: string;
};

const GMAIL_MERCHANTS: Array<{ id: GmailMerchant; label: string }> = [
  { id: "all", label: "All" },
  { id: "tnt", label: "T&T" },
  { id: "pricesmart", label: "PriceSmart" },
  { id: "ubereats", label: "Uber Eats" },
];

const GMAIL_DAY_WINDOWS = [14, 30, 90, 365] as const;

function gmailSyncMessage(data: GmailSyncResponse) {
  const skipDetails = [
    data.skippedPreviouslySeen ? `${data.skippedPreviouslySeen} already ruled out` : null,
    data.skippedNotReceipt ? `${data.skippedNotReceipt} new non-receipts` : null,
    data.skippedNoCandidates ? `${data.skippedNoCandidates} without readable receipt content` : null,
  ].filter(Boolean);
  const details = skipDetails.length > 0 ? ` (${skipDetails.join(", ")})` : "";
  const rateLimit = data.rateLimited ? " Stopped early because Gemini quota/rate limit was hit." : "";
  return `Scanned ${data.scanned ?? 0} emails, checked ${data.candidates ?? 0} bodies/attachments (${
    data.attachments ?? 0
  } attachments), parsed ${data.parsed ?? 0}, duplicates ${data.duplicates ?? 0}, skipped ${
    data.skipped ?? 0
  }${details}, failed ${data.failed ?? 0}.${rateLimit}`;
}

export default function Home() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("text");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [gmailLoading, setGmailLoading] = useState(false);
  const [gmailStatus, setGmailStatus] = useState<GmailStatus | null>(null);
  const [gmailMerchant, setGmailMerchant] = useState<GmailMerchant>("all");
  const [gmailDays, setGmailDays] = useState<number>(90);
  const [gmailMessage, setGmailMessage] = useState<string | null>(null);
  const [photosStatus, setPhotosStatus] = useState<PhotosStatus | null>(null);
  const [photosBusy, setPhotosBusy] = useState(false);
  const [photosSessionId, setPhotosSessionId] = useState<string | null>(null);
  const [photosMessage, setPhotosMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const photosPollTimeoutRef = useRef<number | null>(null);
  const photosPollDeadlineRef = useRef<number | null>(null);

  async function loadGmailStatus() {
    const res = await fetch("/api/google/status");
    const data = (await res.json()) as GmailStatus;
    setGmailStatus(data);
    if (data.error) setGmailMessage(data.error);
  }

  async function loadPhotosStatus() {
    const res = await fetch("/api/google/photos/status");
    const data = (await res.json()) as PhotosStatus;
    setPhotosStatus(data);
    if (data.error) setPhotosMessage(data.error);
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const gmailError = params.get("gmail_error");
    const photosError = params.get("photos_error");
    const nextGmailMessage = gmailError
      ? gmailError
      : params.get("gmail") === "connected"
        ? "Gmail connected. You can process inbox receipts now."
        : null;
    const nextPhotosMessage = photosError
      ? photosError
      : params.get("photos") === "connected"
        ? "Google Photos connected. You can pick receipt photos now."
        : null;

    const timeoutId = window.setTimeout(() => {
      if (nextGmailMessage) setGmailMessage(nextGmailMessage);
      if (nextPhotosMessage) setPhotosMessage(nextPhotosMessage);
      void loadGmailStatus();
      void loadPhotosStatus();
    }, 0);
    return () => {
      window.clearTimeout(timeoutId);
      if (photosPollTimeoutRef.current) window.clearTimeout(photosPollTimeoutRef.current);
    };
  }, []);

  async function syncGmail(merchant = gmailMerchant) {
    setGmailLoading(true);
    setGmailMessage(null);
    try {
      const res = await fetch("/api/google/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ maxResults: 25, merchant, days: gmailDays }),
      });
      const data = await res.json();
      if (!res.ok) {
        const errorData = data as GmailSyncError;
        setGmailMessage(
          errorData.needsReconnect
            ? errorData.error ?? "Google needs to be reconnected with Gmail read permission."
            : errorData.error ?? `Gmail sync failed: ${res.status}`,
        );
        return;
      }
      setGmailMessage(gmailSyncMessage(data as GmailSyncResponse));
    } catch (e) {
      setGmailMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setGmailLoading(false);
    }
  }

  async function importGooglePhotos(sessionId: string, pollIntervalMs = 3000) {
    try {
      const res = await fetch("/api/google/photos/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const data = (await res.json()) as PhotosImportResponse;
      if (res.status === 409 && data.ready === false) {
        const deadline = photosPollDeadlineRef.current ?? Date.now() + (data.timeoutMs ?? 300000);
        photosPollDeadlineRef.current = deadline;
        if (Date.now() > deadline) {
          setPhotosBusy(false);
          setPhotosMessage("Google Photos picker timed out. Start a new pick when you are ready.");
          return;
        }
        setPhotosMessage("Waiting for selected photos...");
        photosPollTimeoutRef.current = window.setTimeout(
          () => void importGooglePhotos(sessionId, data.pollIntervalMs ?? pollIntervalMs),
          data.pollIntervalMs ?? pollIntervalMs,
        );
        return;
      }
      if (!res.ok) {
        setPhotosBusy(false);
        setPhotosMessage(data.error ?? `Google Photos import failed: ${res.status}`);
        return;
      }
      setPhotosBusy(false);
      setPhotosSessionId(null);
      setPhotosMessage(
        `Selected ${data.selected ?? 0} photos, parsed ${data.parsed ?? 0}, duplicates ${
          data.duplicates ?? 0
        }, skipped ${data.skipped ?? 0}, failed ${data.failed ?? 0}.`,
      );
    } catch (e) {
      setPhotosBusy(false);
      setPhotosMessage(e instanceof Error ? e.message : String(e));
    }
  }

  async function startGooglePhotosPick() {
    setPhotosBusy(true);
    setPhotosMessage(null);
    if (photosPollTimeoutRef.current) window.clearTimeout(photosPollTimeoutRef.current);
    photosPollDeadlineRef.current = null;
    try {
      const res = await fetch("/api/google/photos/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ maxItemCount: 10 }),
      });
      const data = (await res.json()) as PhotosSessionResponse;
      if (!res.ok || !data.sessionId || !data.pickerUri) {
        setPhotosBusy(false);
        setPhotosMessage(data.error ?? `Google Photos picker failed: ${res.status}`);
        return;
      }
      const pickerUri = data.pickerUri.endsWith("/autoclose")
        ? data.pickerUri
        : `${data.pickerUri}/autoclose`;
      window.open(pickerUri, "_blank", "noopener,noreferrer");
      setPhotosSessionId(data.sessionId);
      photosPollDeadlineRef.current = Date.now() + (data.timeoutMs ?? 300000);
      setPhotosMessage("Pick receipt photos in Google Photos, then return here.");
      photosPollTimeoutRef.current = window.setTimeout(
        () => void importGooglePhotos(data.sessionId ?? "", data.pollIntervalMs ?? 3000),
        data.pollIntervalMs ?? 3000,
      );
    } catch (e) {
      setPhotosBusy(false);
      setPhotosMessage(e instanceof Error ? e.message : String(e));
    }
  }

  async function submit() {
    setError(null);
    setLoading(true);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120_000);
    try {
      let res: Response;
      if (mode === "image") {
        if (!file) {
          setError("Please choose an image or PDF first.");
          setLoading(false);
          return;
        }
        const form = new FormData();
        form.append("file", file);
        res = await fetch("/api/parse-receipt", {
          method: "POST",
          body: form,
          signal: controller.signal,
        });
      } else {
        if (!text.trim()) {
          setError(mode === "email" ? "Paste the email body first." : "Paste receipt text first.");
          setLoading(false);
          return;
        }
        res = await fetch("/api/parse-receipt", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ kind: mode, text }),
          signal: controller.signal,
        });
      }

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Request failed: ${res.status}`);
        setLoading(false);
        return;
      }
      router.push(`/receipts/${data.receiptId}`);
    } catch (e) {
      const err = e as Error;
      if (err.name === "AbortError") {
        setError(
          "Parse took longer than 2 minutes and was cancelled. Try a shorter receipt, an image instead of pasted text, or check the dev server console for the actual error.",
        );
      } else {
        setError(err.message);
      }
    } finally {
      clearTimeout(timeoutId);
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Add a receipt</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
          Paste receipt text, upload a photo, or paste a forwarded email body. Each item gets
          parsed and saved.
        </p>
      </div>

      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Email receipts</h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
              {gmailStatus?.connected
                ? `Connected${gmailStatus.email ? `: ${gmailStatus.email}` : "."}`
                : "Connect inboxes and import likely receipt emails."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {gmailStatus?.connected ? (
              <>
                <button
                  type="button"
                  onClick={() => void syncGmail()}
                  disabled={gmailLoading}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-medium hover:opacity-90 disabled:opacity-50"
                >
                  <RefreshCw className={`size-4 ${gmailLoading ? "animate-spin" : ""}`} />
                  Process inboxes
                </button>
                <Link
                  href="/settings"
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-zinc-200 dark:border-zinc-800 text-sm font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50"
                >
                  <Settings className="size-4" />
                  Manage
                </Link>
              </>
            ) : (
              <Link
                href="/settings"
                className={`inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium ${
                  gmailStatus
                    ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:opacity-90"
                    : "border border-zinc-200 dark:border-zinc-800 text-zinc-400 pointer-events-none"
                }`}
              >
                <Mail className="size-4" />
                Connect inbox
              </Link>
            )}
          </div>
        </div>
        {gmailStatus && !gmailStatus.configured && (
          <p className="text-sm text-amber-700 dark:text-amber-300">
            Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and EMAIL_ENCRYPTION_KEY to enable Gmail. Yahoo uses app passwords.
          </p>
        )}
        {gmailStatus?.query && (
          <p className="text-xs text-zinc-500 dark:text-zinc-500">Search: {gmailStatus.query}</p>
        )}
        {gmailStatus?.connected && (
          <div className="grid gap-3 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium uppercase text-zinc-500">Merchant</span>
              {GMAIL_MERCHANTS.map((merchant) => (
                <button
                  key={merchant.id}
                  type="button"
                  onClick={() => setGmailMerchant(merchant.id)}
                  disabled={gmailLoading}
                  className={`rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${
                    gmailMerchant === merchant.id
                      ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                      : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800"
                  }`}
                >
                  {merchant.label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium uppercase text-zinc-500">Date</span>
              {GMAIL_DAY_WINDOWS.map((days) => (
                <button
                  key={days}
                  type="button"
                  onClick={() => setGmailDays(days)}
                  disabled={gmailLoading}
                  className={`rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${
                    gmailDays === days
                      ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                      : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800"
                  }`}
                >
                  {days === 365 ? "1 year" : `${days} days`}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {GMAIL_MERCHANTS.filter((merchant) => merchant.id !== "all").map((merchant) => (
                <button
                  key={merchant.id}
                  type="button"
                  onClick={() => void syncGmail(merchant.id)}
                  disabled={gmailLoading}
                  className="inline-flex items-center gap-2 rounded-md border border-zinc-200 px-3 py-2 text-sm font-medium hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:hover:bg-zinc-800"
                >
                  <RefreshCw className={`size-4 ${gmailLoading && gmailMerchant === merchant.id ? "animate-spin" : ""}`} />
                  Sync {merchant.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {gmailLoading ? <EmailScanProgress /> : null}
        {gmailMessage && (
          <div className="bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-3 py-2 rounded-md text-sm">
            {gmailMessage}
          </div>
        )}
      </div>

      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4 space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold">Photo receipts</h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              {photosStatus?.connected
                ? `Google Photos connected${photosStatus.email ? `: ${photosStatus.email}` : "."}`
                : "Pick receipt photos from Google Photos."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {photosStatus?.connected ? (
              <>
                <button
                  type="button"
                  onClick={() => void startGooglePhotosPick()}
                  disabled={photosBusy}
                  className="inline-flex items-center gap-2 rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
                >
                  <Images className="size-4" />
                  Pick from Google Photos
                </button>
                {photosSessionId ? (
                  <button
                    type="button"
                    onClick={() => void importGooglePhotos(photosSessionId)}
                    disabled={!photosBusy}
                    className="inline-flex items-center gap-2 rounded-md border border-zinc-200 px-3 py-2 text-sm font-medium hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:hover:bg-zinc-800"
                  >
                    <RefreshCw className={`size-4 ${photosBusy ? "animate-spin" : ""}`} />
                    Check selection
                  </button>
                ) : null}
              </>
            ) : (
              <a
                href="/api/google/photos/auth?returnTo=/"
                className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium ${
                  photosStatus?.configured
                    ? "bg-zinc-900 text-white hover:opacity-90 dark:bg-zinc-100 dark:text-zinc-900"
                    : "pointer-events-none border border-zinc-200 text-zinc-400 dark:border-zinc-800"
                }`}
              >
                <Images className="size-4" />
                Connect Google Photos
              </a>
            )}
          </div>
        </div>
        {photosStatus && !photosStatus.configured ? (
          <p className="text-sm text-amber-700 dark:text-amber-300">
            Add Google OAuth keys and EMAIL_ENCRYPTION_KEY to enable Google Photos.
          </p>
        ) : null}
        {photosMessage ? (
          <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-950">
            {photosMessage}
          </div>
        ) : null}
      </div>

      <div className="flex gap-2">
        {(["text", "image", "email"] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setMode(m);
              setError(null);
            }}
            className={`px-4 py-2 rounded-md text-sm font-medium border transition-colors ${
              mode === m
                ? "bg-zinc-900 text-white border-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:border-zinc-100"
                : "bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800"
            }`}
          >
            {m === "text" ? "Paste text" : m === "image" ? "Upload photo/PDF" : "Paste email"}
          </button>
        ))}
      </div>

      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4">
        {mode === "image" ? (
          <div
            className="border-2 border-dashed border-zinc-300 dark:border-zinc-700 rounded-md p-8 text-center cursor-pointer hover:border-zinc-400 dark:hover:border-zinc-600"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) setFile(f);
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept="image/*,application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            {file ? (
              <div>
                <p className="font-medium">{file.name}</p>
                <p className="text-xs text-zinc-500 mt-1">
                  {(file.size / 1024).toFixed(1)} KB · {file.type || "unknown"}
                </p>
                <button
                  type="button"
                  className="text-xs text-blue-600 mt-2 underline"
                  onClick={(e) => {
                    e.stopPropagation();
                    setFile(null);
                  }}
                >
                  Clear
                </button>
              </div>
            ) : (
              <div className="text-zinc-500">
                <p>Drop a receipt photo or PDF here</p>
                <p className="text-xs mt-1">or click to choose</p>
              </div>
            )}
          </div>
        ) : (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              mode === "email"
                ? "Paste the full forwarded email body (with headers OK — we strip them)"
                : "Paste raw receipt text here. Each item on its own line is ideal."
            }
            rows={14}
            className="w-full bg-transparent text-sm font-mono outline-none resize-y"
          />
        )}
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 px-4 py-3 rounded-md text-sm">
          {error}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={loading}
          className="px-4 py-2 rounded-md bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {loading ? "Parsing…" : "Parse receipt"}
        </button>
        {loading && (
          <span className="text-sm text-zinc-500">This takes ~5–15s depending on input size.</span>
        )}
      </div>
    </div>
  );
}
