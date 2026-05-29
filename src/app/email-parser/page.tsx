import { SettingsGmailPanel } from "@/app/settings/SettingsGmailPanel";

export const dynamic = "force-dynamic";

export default function EmailParserPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Email parser</h1>
          <p className="mt-1 max-w-3xl text-sm text-zinc-500 dark:text-zinc-400">
            Standalone inbox intake for receipts, orders, inventory, closet items, warranties, and other purchase
            records. Known vendors use procedural parsers first; unknown formats can fall back to the configured LLM.
          </p>
        </div>
        <div className="rounded-full border border-zinc-200 px-3 py-1 text-xs font-medium text-zinc-500 dark:border-zinc-800">
          reusable intake layer
        </div>
      </div>
      <SettingsGmailPanel />
    </div>
  );
}
