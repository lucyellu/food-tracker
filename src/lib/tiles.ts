export const TILE_STYLE_COOKIE = "ft_tiles";
export const TILE_STYLES = ["colour", "vivid", "neutral", "clear"] as const;
export type TileStyle = (typeof TILE_STYLES)[number];

export function isTileStyle(value: string | null | undefined): value is TileStyle {
  return TILE_STYLES.includes(value as TileStyle);
}

/** Client-only: applies the style to the page immediately and remembers it for a year. */
export function applyTileStyle(style: TileStyle) {
  document.documentElement.dataset.tiles = style;
  document.cookie = `${TILE_STYLE_COOKIE}=${style}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`;
}

export const THEME_COOKIE = "ft_theme";
export const THEMES = ["auto", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

export function isTheme(value: string | null | undefined): value is Theme {
  return THEMES.includes(value as Theme);
}

/** Client-only: "auto" follows the device, the others force a theme. */
export function applyTheme(theme: Theme) {
  if (theme === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  document.cookie = `${THEME_COOKIE}=${theme}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`;
}
