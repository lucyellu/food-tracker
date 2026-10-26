"use client";

import { useState } from "react";
import { Palette } from "lucide-react";
import { TILE_STYLES, applyTileStyle, type TileStyle } from "@/lib/tiles";
import { CollapsibleCard } from "./CollapsibleCard";

const OPTIONS: Record<TileStyle, { label: string; hint: string }> = {
  colour: { label: "Colour", hint: "Soft tinted tiles that drain as the food gets used up" },
  vivid: { label: "Vivid", hint: "Saturated tiles (light mode only; dark mode is already vivid)" },
  neutral: { label: "Neutral", hint: "Grey tiles that still drain, with no colour" },
};

export function SettingsAppearancePanel({ initial }: { initial: TileStyle }) {
  const [style, setStyle] = useState<TileStyle>(initial);

  function choose(next: TileStyle) {
    setStyle(next);
    applyTileStyle(next);
  }

  return (
    <CollapsibleCard title="Food tiles" icon={<Palette className="size-4" />} defaultOpen={false}>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        How the food tiles are coloured. The fill level shows how much is left in every style.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {TILE_STYLES.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => choose(key)}
            aria-pressed={style === key}
            className={`${key === "vivid" ? "dark:hidden " : ""}rounded-lg border p-3 text-left ${
              style === key ? "border-zinc-900 dark:border-zinc-100" : "border-zinc-200 dark:border-zinc-800"
            }`}
          >
            <div className="text-sm font-medium">{OPTIONS[key].label}</div>
            <div className="text-xs text-zinc-500">{OPTIONS[key].hint}</div>
          </button>
        ))}
      </div>
    </CollapsibleCard>
  );
}
