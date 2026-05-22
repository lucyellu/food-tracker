"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

export function EnrichNutritionButton({ receiptId }: { receiptId: number }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function enrich() {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/receipts/${receiptId}/nutrition`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? `Nutrition lookup failed: ${res.status}`);
        return;
      }
      setMessage(
        `Matched ${data.matched}, unmatched ${data.unmatched}, skipped ${data.skippedRefunded} refunded.`,
      );
      router.refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col sm:items-end gap-2">
      <button
        type="button"
        onClick={enrich}
        disabled={loading}
        className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-medium hover:opacity-90 disabled:opacity-50"
      >
        <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
        {loading ? "Looking up nutrition" : "Lookup nutrition"}
      </button>
      {message && <p className="text-xs text-zinc-500 max-w-72 sm:text-right">{message}</p>}
    </div>
  );
}
