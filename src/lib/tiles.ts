export const APPEARANCE_EVENT = "ft-appearance";
export const TILE_STYLE_COOKIE = "ft_tiles";
export const TILE_STYLES = ["colour", "vivid", "neutral", "clear"] as const;
export type TileStyle = (typeof TILE_STYLES)[number];

export function isTileStyle(value: string | null | undefined): value is TileStyle {
  return TILE_STYLES.includes(value as TileStyle);
}

/** Client-only: applies the style to the page immediately and remembers it for a year. */
export function applyTileStyle(style: TileStyle) {
  document.documentElement.dataset.tiles = style;
  window.dispatchEvent(new Event(APPEARANCE_EVENT));
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
  window.dispatchEvent(new Event(APPEARANCE_EVENT));
  document.cookie = `${THEME_COOKIE}=${theme}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`;
}

// Runs in <head> before first paint so the saved look is on the page without a flash. React never owns
// these two attributes, so it cannot reset them when the layout re-renders.
export const APPEARANCE_BOOT_SCRIPT = `(function(){try{var c=document.cookie.split("; "),g=function(n){for(var i=0;i<c.length;i++)if(c[i].indexOf(n+"=")===0)return c[i].slice(n.length+1)};var d=document.documentElement,t=g("${TILE_STYLE_COOKIE}"),h=g("${THEME_COOKIE}");d.dataset.tiles=${JSON.stringify(TILE_STYLES)}.indexOf(t)>-1?t:"colour";if(h==="light"||h==="dark")d.dataset.theme=h}catch(e){}})()`;

export function readTileStyle(): TileStyle {
  const value = document.documentElement.dataset.tiles;
  return isTileStyle(value) ? value : "colour";
}

export function readTheme(): Theme {
  const value = document.documentElement.dataset.theme;
  return value === "light" || value === "dark" ? value : "auto";
}

export function subscribeAppearance(callback: () => void) {
  window.addEventListener(APPEARANCE_EVENT, callback);
  return () => window.removeEventListener(APPEARANCE_EVENT, callback);
}
