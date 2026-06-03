import { SettingsGmailPanel } from "./SettingsGmailPanel";
import { SettingsDataPanel } from "./SettingsDataPanel";
import { SettingsTimezonePanel } from "./SettingsTimezonePanel";

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Manage the reusable email parser, backup tracker data, and move between local development, hosted deployments,
          or a fresh database.
        </p>
      </div>
      <SettingsTimezonePanel />
      <SettingsGmailPanel />
      <SettingsDataPanel />
    </div>
  );
}
