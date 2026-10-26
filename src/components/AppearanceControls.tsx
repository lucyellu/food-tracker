"use client";

import { useSyncExternalStore } from "react";
import {
  THEMES,
  TILE_STYLES,
  applyTheme,
  applyTileStyle,
  readTheme,
  readTileStyle,
  subscribeAppearance,
  type Theme,
  type TileStyle,
} from "@/lib/tiles";

const THEME_OPTIONS: Record<Theme, { label: string; hint: string }> = {
  auto: { label: "Auto", hint: "Follow your device" },
  light: { label: "Light", hint: "Cream paper, soft tiles" },
  dark: { label: "Dark", hint: "Black with bold colour" },
};

const TILE_OPTIONS: Record<TileStyle, { label: string; hint: string }> = {
  colour: { label: "Colour", hint: "Tinted tiles that drain as the food gets used up" },
  vivid: { label: "Vivid", hint: "Saturated tiles (light theme; dark is already vivid)" },
  neutral: { label: "Neutral", hint: "Grey tiles that still drain, no colour" },
  clear: { label: "Clear", hint: "No fill, just the food on the page" },
};

function Choice({
  selected,
  label,
  hint,
  onClick,
  className = "",
}: {
  selected: boolean;
  label: string;
  hint: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`${className} rounded-lg border p-3 text-left ${
        selected ? "border-zinc-900 dark:border-zinc-100" : "border-zinc-200 dark:border-zinc-800"
      }`}
    >
      <div className="text-sm font-medium">{label}</div>
      <div className="text-xs text-zinc-500">{hint}</div>
    </button>
  );
}

// The data attributes on the html element are the source of truth, so every copy of these controls stays in sync.
export function AppearanceControls({ columns = "wide" }: { columns?: "wide" | "narrow" }) {
  const theme = useSyncExternalStore(subscribeAppearance, readTheme, () => "auto" as Theme);
  const tiles = useSyncExternalStore(subscribeAppearance, readTileStyle, () => "colour" as TileStyle);
  const themeGrid = columns === "wide" ? "sm:grid-cols-3" : "grid-cols-3";
  const tileGrid = columns === "wide" ? "sm:grid-cols-4" : "grid-cols-2";

  return (
    <div>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">Theme</p>
      <div className={`mt-2 grid gap-2 ${themeGrid}`}>
        {THEMES.map((key) => (
          <Choice
            key={key}
            selected={theme === key}
            label={THEME_OPTIONS[key].label}
            hint={THEME_OPTIONS[key].hint}
            onClick={() => applyTheme(key)}
          />
        ))}
      </div>
      <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">Food tiles</p>
      <div className={`mt-2 grid gap-2 ${tileGrid}`}>
        {TILE_STYLES.map((key) => (
          <Choice
            key={key}
            selected={tiles === key}
            label={TILE_OPTIONS[key].label}
            hint={TILE_OPTIONS[key].hint}
            className={key === "vivid" ? "dark:hidden" : ""}
            onClick={() => applyTileStyle(key)}
          />
        ))}
      </div>
    </div>
  );
}
