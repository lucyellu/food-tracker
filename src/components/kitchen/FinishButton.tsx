"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, Undo2 } from "lucide-react";

// Marks a food as used up (or puts it back). Sits beside a tile, outside its link.
export function FinishButton({
  slug,
  finished = false,
  variant = "icon",
}: {
  slug: string;
  finished?: boolean;
  variant?: "icon" | "text";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    try {
      const res = await fetch(`/api/foods/${slug}/finished`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ finished: !finished }),
      });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const label = finished ? "Back in pantry" : "Used it up";
  const Icon = finished ? Undo2 : Check;

  if (variant === "text") {
    return (
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={busy}
        className="label-mono inline-flex items-center gap-2 rounded-full border border-line px-4 py-2 text-ink hover:bg-paper-raised disabled:opacity-50"
      >
        <Icon className="h-3.5 w-3.5" /> {busy ? "…" : label}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={busy}
      title={label}
      aria-label={`${label}: ${slug}`}
      className="absolute right-1.5 top-1.5 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-paper-raised/90 text-ink shadow-sm backdrop-blur transition hover:bg-ink hover:text-paper disabled:opacity-50 md:opacity-0 md:group-hover/tile:opacity-100 md:focus-visible:opacity-100"
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}
