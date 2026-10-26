"use client";

import { Download, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { CollapsibleCard } from "./CollapsibleCard";

type ImportSummary = {
  importedReceipts: number;
  skippedReceipts: number;
  importedItems: number;
  importedNutritionFacts: number;
  importedLogs: number;
  importedSettings: boolean;
};

function formatSummary(summary: ImportSummary) {
  return [
    `${summary.importedReceipts} receipts imported`,
    `${summary.skippedReceipts} duplicates skipped`,
    `${summary.importedItems} items`,
    `${summary.importedNutritionFacts} nutrition rows`,
    `${summary.importedLogs} logs`,
    summary.importedSettings ? "settings updated" : "settings unchanged",
  ].join(" · ");
}

export function SettingsDataPanel() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function exportData() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/settings/export");
      if (!res.ok) throw new Error("Could not export data.");
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `food-tracker-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      setMessage("Export created.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not export data.");
    } finally {
      setBusy(false);
    }
  }

  async function importData(file: File | null) {
    if (!file) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      const res = await fetch("/api/settings/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed),
      });
      const data = (await res.json()) as { summary?: ImportSummary; error?: string };
      if (!res.ok || !data.summary) throw new Error(data.error || "Could not import data.");
      setMessage(formatSummary(data.summary));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not import data.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <CollapsibleCard title="Data backup">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="mt-1 max-w-2xl text-sm text-zinc-500 dark:text-zinc-400">
            Export receipts, items, nutrition facts, consumption logs, and people/day settings as JSON. Gmail OAuth
            tokens and encrypted email credentials are never included.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:w-auto">
          <button
            type="button"
            onClick={exportData}
            disabled={busy}
            className="inline-flex items-center justify-center gap-2 rounded-md border border-zinc-200 px-3 py-2 text-sm font-medium hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            <Download className="h-4 w-4" />
            Export
          </button>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="inline-flex items-center justify-center gap-2 rounded-md border border-zinc-200 px-3 py-2 text-sm font-medium hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            <Upload className="h-4 w-4" />
            Import
          </button>
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(event) => void importData(event.target.files?.[0] ?? null)}
      />
      {message ? (
        <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
          {message}
        </div>
      ) : null}
      {error ? (
        <div className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
          {error}
        </div>
      ) : null}
    </CollapsibleCard>
  );
}
