export const TILE_STYLE_COOKIE = "ft_tiles";
export const TILE_STYLES = ["colour", "vivid", "neutral"] as const;
export type TileStyle = (typeof TILE_STYLES)[number];

export function isTileStyle(value: string | null | undefined): value is TileStyle {
  return TILE_STYLES.includes(value as TileStyle);
}

/** Client-only: applies the style to the page immediately and remembers it for a year. */
export function applyTileStyle(style: TileStyle) {
  document.documentElement.dataset.tiles = style;
  document.cookie = `${TILE_STYLE_COOKIE}=${style}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`;
}
