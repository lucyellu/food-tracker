"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function RecategorizeButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setDone(null);
    try {
      const res = await fetch("/api/receipts/recategorize", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as {
        scanned?: number;
        updated?: number;
      };
      if (res.ok) {
        setDone(`Categorized ${data.updated ?? 0} item${data.updated === 1 ? "" : "s"}.`);
        router.refresh();
      } else {
        setDone("Failed to categorize items.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {done ? <span className="text-xs text-zinc-500">{done}</span> : null}
      <button
        type="button"
        disabled={busy}
        onClick={run}
        className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
      >
        {busy ? "Categorizing…" : "Categorize uncategorized items"}
      </button>
    </div>
  );
}
