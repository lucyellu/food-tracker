import { cookies } from "next/headers";
import { THEME_COOKIE, TILE_STYLE_COOKIE, isTheme, isTileStyle } from "@/lib/tiles";
import { authEnabled } from "@/lib/auth/session";
import { SettingsGmailPanel } from "./SettingsGmailPanel";
import { SettingsDataPanel } from "./SettingsDataPanel";
import { SettingsLlmPanel } from "./SettingsLlmPanel";
import { SettingsTimezonePanel } from "./SettingsTimezonePanel";
import { SettingsAppearancePanel } from "./SettingsAppearancePanel";

export default async function SettingsPage() {
  const jar = await cookies();
  const saved = jar.get(TILE_STYLE_COOKIE)?.value;
  const savedTheme = jar.get(THEME_COOKIE)?.value;
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        {authEnabled() && (
          <form action="/api/auth/logout" method="post" className="float-right">
            <button type="submit" className="label-mono underline underline-offset-4">
              Sign out
            </button>
          </form>
        )}
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Manage the reusable email parser, backup tracker data, and move between local development, hosted deployments,
          or a fresh database.
        </p>
      </div>
      <SettingsGmailPanel />
      <SettingsLlmPanel />
      <SettingsAppearancePanel
        initialTiles={isTileStyle(saved) ? saved : "colour"}
        initialTheme={isTheme(savedTheme) ? savedTheme : "auto"}
      />
      <SettingsTimezonePanel />
      <SettingsDataPanel />
    </div>
  );
}
