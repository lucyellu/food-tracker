"use client";

import { useState } from "react";
import { Palette } from "lucide-react";
import { THEMES, TILE_STYLES, applyTheme, applyTileStyle, type Theme, type TileStyle } from "@/lib/tiles";
import { CollapsibleCard } from "./CollapsibleCard";

const THEME_OPTIONS: Record<Theme, { label: string; hint: string }> = {
  auto: { label: "Auto", hint: "Follow your device" },
  light: { label: "Light", hint: "Cream paper, soft tiles" },
  dark: { label: "Dark", hint: "Black with bold colour" },
};

const TILE_OPTIONS: Record<TileStyle, { label: string; hint: string }> = {
  colour: { label: "Colour", hint: "Tinted tiles that drain as the food gets used up" },
  vivid: { label: "Vivid", hint: "Saturated tiles (light theme; dark is already vivid)" },
  neutral: { label: "Neutral", hint: "Grey tiles that still drain, no colour" },
  clear: { label: "Clear", hint: "No fill at all, just the food on the page" },
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

export function SettingsAppearancePanel({
  initialTiles,
  initialTheme,
}: {
  initialTiles: TileStyle;
  initialTheme: Theme;
}) {
  const [tiles, setTiles] = useState<TileStyle>(initialTiles);
  const [theme, setTheme] = useState<Theme>(initialTheme);

  return (
    <CollapsibleCard title="Appearance" icon={<Palette className="size-4" />} defaultOpen={false}>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Theme</p>
      <div className="mt-2 grid gap-3 sm:grid-cols-3">
        {THEMES.map((key) => (
          <Choice
            key={key}
            selected={theme === key}
            label={THEME_OPTIONS[key].label}
            hint={THEME_OPTIONS[key].hint}
            onClick={() => {
              setTheme(key);
              applyTheme(key);
            }}
          />
        ))}
      </div>

      <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">
        Food tiles. The fill level shows how much is left in every style except Clear.
      </p>
      <div className="mt-2 grid gap-3 sm:grid-cols-4">
        {TILE_STYLES.map((key) => (
          <Choice
            key={key}
            selected={tiles === key}
            label={TILE_OPTIONS[key].label}
            hint={TILE_OPTIONS[key].hint}
            className={key === "vivid" ? "dark:hidden" : ""}
            onClick={() => {
              setTiles(key);
              applyTileStyle(key);
            }}
          />
        ))}
      </div>
    </CollapsibleCard>
  );
}
