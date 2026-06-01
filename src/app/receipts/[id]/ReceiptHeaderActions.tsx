"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ReceiptHeaderActions({
  receiptId,
  vendor,
  purchasedAt,
  total,
}: {
  receiptId: number;
  vendor: string | null;
  purchasedAt: string | null;
  total: number | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    vendor: vendor ?? "",
    purchasedAt: purchasedAt && /^\d{4}-\d{2}-\d{2}$/.test(purchasedAt) ? purchasedAt : "",
    total: total == null ? "" : String(total),
  });

  async function save() {
    setBusy(true);
    try {
      const res = await fetch(`/api/receipts/${receiptId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          vendor: form.vendor.trim() || null,
          purchasedAt: form.purchasedAt.trim() || null,
          total: form.total.trim() === "" ? null : Number(form.total),
        }),
      });
      if (res.ok) {
        setEditing(false);
        router.refresh();
      } else {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        alert(data.error ?? "Could not save receipt");
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm("Delete this entire receipt and all its items? This cannot be undone.")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/receipts/${receiptId}`, { method: "DELETE" });
      if (res.ok) {
        router.push("/receipts");
        router.refresh();
      } else {
        alert("Could not delete receipt");
        setBusy(false);
      }
    } catch {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <div className="rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800">
        <div className="space-y-2">
          <label className="block text-xs">
            <span className="mb-1 block text-zinc-500">Vendor</span>
            <input
              value={form.vendor}
              onChange={(e) => setForm((s) => ({ ...s, vendor: e.target.value }))}
              className="w-full rounded-md border border-zinc-200 bg-transparent px-2 py-1.5 dark:border-zinc-800"
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs">
              <span className="mb-1 block text-zinc-500">Date</span>
              <input
                type="date"
                value={form.purchasedAt}
                onChange={(e) => setForm((s) => ({ ...s, purchasedAt: e.target.value }))}
                className="w-full rounded-md border border-zinc-200 bg-transparent px-2 py-1.5 dark:border-zinc-800"
              />
            </label>
            <label className="text-xs">
              <span className="mb-1 block text-zinc-500">Total</span>
              <input
                type="number"
                min={0}
                step={0.01}
                value={form.total}
                onChange={(e) => setForm((s) => ({ ...s, total: e.target.value }))}
                className="w-full rounded-md border border-zinc-200 bg-transparent px-2 py-1.5 dark:border-zinc-800"
              />
            </label>
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={save}
            className="rounded-md border border-zinc-900 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950"
          >
            Save
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setEditing(false)}
            className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => setEditing(true)}
        className="flex-1 rounded-md border border-zinc-200 px-3 py-2 text-center text-sm font-medium hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
      >
        Edit receipt
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={remove}
        className="flex-1 rounded-md border border-red-200 px-3 py-2 text-center text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:hover:bg-red-950/30"
      >
        Delete
      </button>
    </div>
  );
}
