"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus } from "lucide-react";

export function EnrichProductsButton({ receiptId }: { receiptId: number }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function enrich() {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/receipts/${receiptId}/products`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? `Product lookup failed: ${res.status}`);
        return;
      }
      const skipped = data.skipped ? `, skipped ${data.skipped}` : "";
      const openFoodFacts = data.openFoodFactsLinked
        ? `, Open Food Facts ${data.openFoodFactsLinked}${data.openFoodFactsNutrition ? ` with nutrition ${data.openFoodFactsNutrition}` : ""}`
        : "";
      setMessage(
        `Linked ${data.linked}, fallback links ${data.fallbackLinks}, failed ${data.failed}${openFoodFacts}${skipped}.`,
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
        className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md border border-zinc-200 dark:border-zinc-800 text-sm font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50"
      >
        <ImagePlus className={`size-4 ${loading ? "animate-pulse" : ""}`} />
        {loading ? "Finding products" : "Find product info"}
      </button>
      {message && <p className="text-xs text-zinc-500 max-w-72 sm:text-right">{message}</p>}
    </div>
  );
}
