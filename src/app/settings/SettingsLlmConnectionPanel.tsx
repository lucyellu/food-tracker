"use client";

import { useState } from "react";
import { Brain, CheckCircle2, CircleSlash, Loader2, PlugZap, Sparkles, TriangleAlert } from "lucide-react";
import type { LlmProviderStatus } from "@/lib/llm/status";
import { CollapsibleCard } from "./CollapsibleCard";

type LlmStatusResponse = {
  providers: LlmProviderStatus[];
  checkedAt: string;
};

function StatusBadge({ provider }: { provider: LlmProviderStatus }) {
  const state = provider.state;
  const classes =
    state === "connected"
      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
      : state === "quota_limited"
        ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
        : state === "env_set"
          ? "bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300"
          : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400";
  const icon =
    state === "connected" ? (
      <CheckCircle2 className="size-3.5" />
    ) : state === "quota_limited" || state === "not_connected" ? (
      <TriangleAlert className="size-3.5" />
    ) : (
      <CircleSlash className="size-3.5" />
    );
  const label =
    state === "connected"
      ? "Connected"
      : state === "quota_limited"
        ? "Quota limited"
        : state === "env_set"
          ? "Env set"
          : state === "not_connected"
            ? "Not connected"
            : "Not set";

  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ${classes}`}>
      {icon}
      {label}
    </span>
  );
}

export function SettingsLlmConnectionPanel({
  initialProviders,
  textOrder,
}: {
  initialProviders: LlmProviderStatus[];
  textOrder: string;
}) {
  const [providers, setProviders] = useState(initialProviders);
  const [busy, setBusy] = useState(false);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const configuredCount = providers.filter((provider) => provider.configured).length;

  async function testConnections() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/settings/llm-status", { cache: "no-store" });
      const data = (await response.json()) as Partial<LlmStatusResponse> & { error?: string };
      if (!response.ok || !data.providers) {
        throw new Error(data.error || "Could not test provider connections.");
      }
      setProviders(data.providers);
      setCheckedAt(data.checkedAt ?? new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not test provider connections.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <CollapsibleCard title="LLM providers" icon={<Brain className="size-4" />}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="mt-1 max-w-2xl text-sm text-zinc-500 dark:text-zinc-400">
            Receipt parsing uses known vendor parsers first, then configured model providers for unknown formats.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="inline-flex h-10 items-center gap-2 rounded-md border border-zinc-200 px-3 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-300">
            <Sparkles className="size-4" />
            {configuredCount} env set
          </div>
          <button
            type="button"
            onClick={() => void testConnections()}
            disabled={busy}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-zinc-200 px-3 text-sm font-medium hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-800 dark:hover:bg-zinc-800"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <PlugZap className="size-4" />}
            Test connections
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-2">
        {providers.map((provider) => (
          <div key={provider.key} className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-medium">{provider.label}</div>
                <div className="mt-1 text-xs text-zinc-500">{provider.role}</div>
              </div>
              <StatusBadge provider={provider} />
            </div>
            <div className="mt-3 grid gap-1 text-xs text-zinc-500">
              <div>
                Model: <span className="font-medium text-zinc-700 dark:text-zinc-300">{provider.model}</span>
              </div>
              <div>
                Env: <span className="font-medium text-zinc-700 dark:text-zinc-300">{provider.env}</span>
              </div>
              <div>
                Status: <span className="font-medium text-zinc-700 dark:text-zinc-300">{provider.note}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
        Text order: <span className="font-medium">{textOrder}</span>
        {checkedAt ? (
          <span className="ml-2 text-xs text-zinc-500">
            Checked {new Date(checkedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
          </span>
        ) : null}
      </div>

      {error ? (
        <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
          {error}
        </div>
      ) : null}
    </CollapsibleCard>
  );
}
