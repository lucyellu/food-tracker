export type LlmProviderState = "env_set" | "not_set" | "connected" | "quota_limited" | "not_connected";

export type LlmProviderStatus = {
  key: string;
  label: string;
  state: LlmProviderState;
  configured: boolean;
  connected?: boolean;
  model: string;
  role: string;
  env: string;
  note: string;
  status?: number;
};

type ProviderDefinition = {
  key: string;
  label: string;
  apiKeyEnv?: string | string[];
  baseUrlEnv?: string;
  baseUrl?: string;
  modelEnv?: string;
  defaultModel: string;
  role: string;
  env: string;
  kind: "openai-compatible" | "gemini" | "gateway" | "google-vision";
};

const REQUEST_TIMEOUT_MS = 20_000;

function env(name: string) {
  const value = process.env[name]?.trim();
  return value || null;
}

function firstEnv(names: string | string[] | undefined) {
  const candidates = Array.isArray(names) ? names : names ? [names] : [];
  for (const name of candidates) {
    const value = env(name);
    if (value) return value;
  }
  return null;
}

function providerDefinitions(): ProviderDefinition[] {
  const preferDeepSeek = process.env.PREFER_DEEPSEEK === "true";
  return [
    {
      key: "cerebras",
      label: "Cerebras",
      apiKeyEnv: "CEREBRAS_API_KEY",
      baseUrl: "https://api.cerebras.ai/v1",
      modelEnv: "CEREBRAS_TEXT_MODEL",
      defaultModel: "gpt-oss-120b",
      role: "Text receipt fallback",
      env: "CEREBRAS_API_KEY",
      kind: "openai-compatible",
    },
    {
      key: "groq",
      label: "Groq",
      apiKeyEnv: "GROQ_API_KEY",
      baseUrl: "https://api.groq.com/openai/v1",
      modelEnv: "GROQ_TEXT_MODEL",
      defaultModel: "meta-llama/llama-4-scout-17b-16e-instruct",
      role: "Text receipt fallback",
      env: "GROQ_API_KEY",
      kind: "openai-compatible",
    },
    {
      key: "gemini",
      label: "Gemini",
      apiKeyEnv: "GEMINI_API_KEY",
      defaultModel: "gemini-2.0-flash",
      role: "Text fallback and PDF parsing",
      env: "GEMINI_API_KEY",
      kind: "gemini",
    },
    {
      key: "google_vision",
      label: "Google Vision",
      apiKeyEnv: ["GOOGLE_CLOUD_VISION_API_KEY", "GOOGLE_VISION_API_KEY"],
      defaultModel: "DOCUMENT_TEXT_DETECTION + WEB_DETECTION",
      role: "Image OCR and reverse image fallback",
      env: "GOOGLE_CLOUD_VISION_API_KEY / GOOGLE_VISION_API_KEY",
      kind: "google-vision",
    },
    {
      key: "deepseek",
      label: "DeepSeek",
      apiKeyEnv: "DEEPSEEK_API_KEY",
      baseUrl: "https://api.deepseek.com",
      defaultModel: "deepseek-chat",
      role: preferDeepSeek ? "Preferred text parser" : "Fallback after Gemini",
      env: "DEEPSEEK_API_KEY",
      kind: "openai-compatible",
    },
    {
      key: "gateway",
      label: "Local gateway",
      baseUrlEnv: "AI_FREE_BASE_URL",
      modelEnv: "AI_FREE_TEXT_MODEL",
      defaultModel: "gpt-oss-120b",
      role: "OpenAI-compatible local/free gateway",
      env: "AI_FREE_BASE_URL",
      kind: "gateway",
    },
  ];
}

function configured(definition: ProviderDefinition) {
  return definition.baseUrlEnv ? Boolean(env(definition.baseUrlEnv)) : Boolean(firstEnv(definition.apiKeyEnv));
}

function modelFor(definition: ProviderDefinition) {
  return (definition.modelEnv && env(definition.modelEnv)) || definition.defaultModel;
}

export function getLlmProviderStatuses(): LlmProviderStatus[] {
  return providerDefinitions().map((definition) => {
    const isConfigured = configured(definition);
    return {
      key: definition.key,
      label: definition.label,
      state: isConfigured ? "env_set" : "not_set",
      configured: isConfigured,
      model: modelFor(definition),
      role: definition.role,
      env: definition.env,
      note: isConfigured ? "Env set" : `${definition.env} not set`,
    };
  });
}

export function llmTextOrder() {
  return process.env.PREFER_DEEPSEEK === "true"
    ? "Procedural parsers -> DeepSeek"
    : "Procedural parsers -> Cerebras -> Groq -> local gateway -> Gemini -> DeepSeek";
}

async function fetchJson(url: string, options: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text.slice(0, 180);
    }
    return { ok: response.ok, status: response.status, data };
  } finally {
    clearTimeout(timer);
  }
}

function errorSummary(data: unknown) {
  if (!data) return "No response body";
  if (typeof data === "string") return data.slice(0, 180);
  if (typeof data !== "object") return String(data);
  const record = data as {
    error?: { message?: string } | string;
    message?: string;
  };
  const message =
    (typeof record.error === "object" && record.error.message) ||
    record.message ||
    (typeof record.error === "string" ? record.error : JSON.stringify(data).slice(0, 180));
  return String(message).replace(/[A-Za-z0-9_-]{24,}/g, "[redacted]");
}

function providerNote(status: number, ok: boolean, data: unknown) {
  if (ok) return "Connected";
  if (status === 429) return "Provider quota/rate limit reached";
  return errorSummary(data).slice(0, 180);
}

function stateForStatus(status: number, ok: boolean): LlmProviderState {
  if (ok) return "connected";
  if (status === 429) return "quota_limited";
  return "not_connected";
}

async function testOpenAiCompatible(definition: ProviderDefinition): Promise<LlmProviderStatus> {
  const apiKey = definition.apiKeyEnv ? firstEnv(definition.apiKeyEnv) : env("AI_FREE_API_KEY") || "local-dev";
  const baseUrl = definition.baseUrlEnv ? env(definition.baseUrlEnv) : definition.baseUrl;
  const baseStatus = getLlmProviderStatuses().find((status) => status.key === definition.key);
  if (!baseStatus || !baseUrl || (definition.apiKeyEnv && !apiKey)) {
    return baseStatus ?? {
      key: definition.key,
      label: definition.label,
      state: "not_set",
      configured: false,
      model: modelFor(definition),
      role: definition.role,
      env: definition.env,
      note: `${definition.env} not set`,
    };
  }

  try {
    const result = await fetchJson(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: baseStatus.model,
        messages: [{ role: "user", content: "Reply with one word: ok" }],
        max_tokens: 2,
        temperature: 0,
      }),
    });
    return {
      ...baseStatus,
      state: stateForStatus(result.status, result.ok),
      connected: result.ok,
      status: result.status,
      note: providerNote(result.status, result.ok, result.data),
    } as LlmProviderStatus;
  } catch (error) {
    return {
      ...baseStatus,
      state: "not_connected",
      note: error instanceof Error ? error.message : String(error),
    };
  }
}

async function testGemini(definition: ProviderDefinition): Promise<LlmProviderStatus> {
  const baseStatus = getLlmProviderStatuses().find((status) => status.key === definition.key);
  const apiKey = firstEnv(definition.apiKeyEnv);
  if (!baseStatus || !apiKey) {
    return baseStatus ?? {
      key: definition.key,
      label: definition.label,
      state: "not_set",
      configured: false,
      model: modelFor(definition),
      role: definition.role,
      env: definition.env,
      note: `${definition.env} not set`,
    };
  }

  try {
    const result = await fetchJson(
      `https://generativelanguage.googleapis.com/v1beta/models/${baseStatus.model}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: "Reply with one word: ok" }] }],
          generationConfig: { maxOutputTokens: 2, temperature: 0 },
        }),
      },
    );
    return {
      ...baseStatus,
      state: stateForStatus(result.status, result.ok),
      status: result.status,
      note: providerNote(result.status, result.ok, result.data),
    };
  } catch (error) {
    return {
      ...baseStatus,
      state: "not_connected",
      note: error instanceof Error ? error.message : String(error),
    };
  }
}

async function testGoogleVision(definition: ProviderDefinition): Promise<LlmProviderStatus> {
  const baseStatus = getLlmProviderStatuses().find((status) => status.key === definition.key);
  const apiKey = firstEnv(definition.apiKeyEnv);
  if (!baseStatus || !apiKey) {
    return baseStatus ?? {
      key: definition.key,
      label: definition.label,
      state: "not_set",
      configured: false,
      model: modelFor(definition),
      role: definition.role,
      env: definition.env,
      note: `${definition.env} not set`,
    };
  }

  try {
    const result = await fetchJson(`https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requests: [
          {
            image: {
              content:
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
            },
            features: [{ type: "LABEL_DETECTION", maxResults: 1 }],
          },
        ],
      }),
    });
    return {
      ...baseStatus,
      state: stateForStatus(result.status, result.ok),
      connected: result.ok,
      status: result.status,
      note: providerNote(result.status, result.ok, result.data),
    };
  } catch (error) {
    return {
      ...baseStatus,
      state: "not_connected",
      note: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function checkLlmProviderConnections() {
  return Promise.all(
    providerDefinitions().map((definition) => {
      if (!configured(definition)) {
        return Promise.resolve(getLlmProviderStatuses().find((status) => status.key === definition.key)!);
      }
      if (definition.kind === "gemini") return testGemini(definition);
      if (definition.kind === "google-vision") return testGoogleVision(definition);
      return testOpenAiCompatible(definition);
    }),
  );
}
