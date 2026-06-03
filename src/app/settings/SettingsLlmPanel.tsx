import { Brain, CheckCircle2, CircleSlash, Sparkles } from "lucide-react";

type ProviderStatus = {
  label: string;
  configured: boolean;
  model: string;
  role: string;
  env: string;
};

function env(name: string) {
  const value = process.env[name]?.trim();
  return value || null;
}

function StatusBadge({ configured }: { configured: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ${
        configured
          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
          : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
      }`}
    >
      {configured ? <CheckCircle2 className="size-3.5" /> : <CircleSlash className="size-3.5" />}
      {configured ? "Configured" : "Not set"}
    </span>
  );
}

export function SettingsLlmPanel() {
  const preferDeepSeek = process.env.PREFER_DEEPSEEK === "true";
  const providers: ProviderStatus[] = [
    {
      label: "Cerebras",
      configured: Boolean(env("CEREBRAS_API_KEY")),
      model: env("CEREBRAS_TEXT_MODEL") ?? "gpt-oss-120b",
      role: "Text receipt fallback",
      env: "CEREBRAS_API_KEY",
    },
    {
      label: "Groq",
      configured: Boolean(env("GROQ_API_KEY")),
      model: env("GROQ_TEXT_MODEL") ?? "meta-llama/llama-4-scout-17b-16e-instruct",
      role: "Text receipt fallback",
      env: "GROQ_API_KEY",
    },
    {
      label: "Gemini",
      configured: Boolean(env("GEMINI_API_KEY")),
      model: "gemini-2.0-flash",
      role: "Text fallback and PDF parsing",
      env: "GEMINI_API_KEY",
    },
    {
      label: "DeepSeek",
      configured: Boolean(env("DEEPSEEK_API_KEY")),
      model: "deepseek-chat",
      role: preferDeepSeek ? "Preferred text parser" : "Fallback after Gemini",
      env: "DEEPSEEK_API_KEY",
    },
    {
      label: "Local gateway",
      configured: Boolean(env("AI_FREE_BASE_URL")),
      model: env("AI_FREE_TEXT_MODEL") ?? "gpt-oss-120b",
      role: "OpenAI-compatible local/free gateway",
      env: "AI_FREE_BASE_URL",
    },
  ];

  const configuredCount = providers.filter((provider) => provider.configured).length;
  const textOrder = preferDeepSeek
    ? "Procedural parsers -> DeepSeek"
    : "Procedural parsers -> Cerebras -> Groq -> local gateway -> Gemini -> DeepSeek";

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="inline-flex items-center gap-2 text-base font-semibold">
            <Brain className="size-4" />
            LLM providers
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-zinc-500 dark:text-zinc-400">
            Receipt parsing uses known vendor parsers first, then configured model providers for unknown formats.
          </p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-md border border-zinc-200 px-3 py-2 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-300">
          <Sparkles className="size-4" />
          {configuredCount} active
        </div>
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-2">
        {providers.map((provider) => (
          <div
            key={provider.label}
            className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-medium">{provider.label}</div>
                <div className="mt-1 text-xs text-zinc-500">{provider.role}</div>
              </div>
              <StatusBadge configured={provider.configured} />
            </div>
            <div className="mt-3 grid gap-1 text-xs text-zinc-500">
              <div>
                Model: <span className="font-medium text-zinc-700 dark:text-zinc-300">{provider.model}</span>
              </div>
              <div>
                Env: <span className="font-medium text-zinc-700 dark:text-zinc-300">{provider.env}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
        Text order: <span className="font-medium">{textOrder}</span>
      </div>
    </section>
  );
}
