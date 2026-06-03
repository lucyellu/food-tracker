import OpenAI from "openai";
import { SYSTEM_PROMPT, type ParsedReceipt } from "./schema";
import { tryParseReceipt, compressWhitespace, withRetry } from "./util";

const DIRECT_TIMEOUT_MS = 120_000;
const GATEWAY_TIMEOUT_MS = 20_000;
const CEREBRAS_BASE_URL = "https://api.cerebras.ai/v1";
const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
const DEFAULT_CEREBRAS_TEXT_MODEL = "gpt-oss-120b";
const DEFAULT_GROQ_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";
const DEFAULT_GATEWAY_TEXT_MODEL = "gpt-oss-120b";
const DEFAULT_GATEWAY_VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";

type AiProvider = {
  apiKey: string;
  baseURL: string;
  label: string;
  model: string;
  timeoutMs: number;
};

function env(name: string) {
  const value = process.env[name]?.trim();
  return value || undefined;
}

export function isAiFreeConfigured() {
  return Boolean(env("CEREBRAS_API_KEY") || env("GROQ_API_KEY") || env("AI_FREE_BASE_URL"));
}

export function isAiFreeMediaConfigured(mimeType: string) {
  return Boolean((mimeType.startsWith("image/") && env("GROQ_API_KEY")) || env("AI_FREE_BASE_URL"));
}

function getClient(provider: AiProvider) {
  return new OpenAI({
    apiKey: provider.apiKey,
    baseURL: provider.baseURL,
    timeout: provider.timeoutMs,
  });
}

function textProviders(): AiProvider[] {
  const providers: AiProvider[] = [];
  const cerebrasApiKey = env("CEREBRAS_API_KEY");
  const groqApiKey = env("GROQ_API_KEY");
  const gatewayBaseURL = env("AI_FREE_BASE_URL");

  if (cerebrasApiKey) {
    providers.push({
      apiKey: cerebrasApiKey,
      baseURL: CEREBRAS_BASE_URL,
      label: "Cerebras text",
      model: env("CEREBRAS_TEXT_MODEL") || DEFAULT_CEREBRAS_TEXT_MODEL,
      timeoutMs: DIRECT_TIMEOUT_MS,
    });
  }

  if (groqApiKey) {
    providers.push({
      apiKey: groqApiKey,
      baseURL: GROQ_BASE_URL,
      label: "Groq text",
      model: env("GROQ_TEXT_MODEL") || DEFAULT_GROQ_MODEL,
      timeoutMs: DIRECT_TIMEOUT_MS,
    });
  }

  if (gatewayBaseURL) {
    providers.push({
      apiKey: env("AI_FREE_API_KEY") || "local-dev",
      baseURL: gatewayBaseURL,
      label: "AI Free gateway text",
      model: env("AI_FREE_TEXT_MODEL") || DEFAULT_GATEWAY_TEXT_MODEL,
      timeoutMs: GATEWAY_TIMEOUT_MS,
    });
  }

  return providers;
}

function mediaProviders(mimeType: string): AiProvider[] {
  const providers: AiProvider[] = [];
  const groqApiKey = env("GROQ_API_KEY");
  const gatewayBaseURL = env("AI_FREE_BASE_URL");

  if (mimeType.startsWith("image/") && groqApiKey) {
    providers.push({
      apiKey: groqApiKey,
      baseURL: GROQ_BASE_URL,
      label: "Groq vision",
      model: env("GROQ_VISION_MODEL") || DEFAULT_GROQ_MODEL,
      timeoutMs: DIRECT_TIMEOUT_MS,
    });
  }

  if (gatewayBaseURL) {
    providers.push({
      apiKey: env("AI_FREE_API_KEY") || "local-dev",
      baseURL: gatewayBaseURL,
      label: "AI Free gateway vision",
      model: env("AI_FREE_VISION_MODEL") || DEFAULT_GATEWAY_VISION_MODEL,
      timeoutMs: GATEWAY_TIMEOUT_MS,
    });
  }

  return providers;
}

async function parseRaw(callOnce: (extraInstruction?: string) => Promise<string>, label: string) {
  const raw = await callOnce();
  const parsed = tryParseReceipt(raw);
  if (parsed.ok) return parsed.value;

  const retry = await callOnce(
    `Your previous response was invalid: ${parsed.error}\nReturn only valid JSON matching the schema.`,
  );
  const reparsed = tryParseReceipt(retry);
  if (reparsed.ok) return reparsed.value;

  throw new Error(`${label} returned invalid JSON twice: ${reparsed.error}`);
}

async function tryProviders(
  providers: AiProvider[],
  kind: string,
  callProvider: (provider: AiProvider, extraInstruction?: string) => Promise<string>,
): Promise<ParsedReceipt> {
  if (providers.length === 0) {
    throw new Error(`No configured ${kind} provider.`);
  }

  const errors: string[] = [];
  for (const provider of providers) {
    try {
      return await parseRaw(
        (extraInstruction) => callProvider(provider, extraInstruction),
        provider.label,
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      errors.push(`${provider.label}: ${message}`);
      console.warn(`${provider.label} failed; trying next free provider: ${message}`);
    }
  }

  throw new Error(`All ${kind} providers failed: ${errors.join(" | ")}`);
}

export async function parseAiFreeText(text: string): Promise<ParsedReceipt> {
  const cleaned = compressWhitespace(text);
  const providers = textProviders();

  return tryProviders(providers, "AI-free text", async (provider, extraInstruction = "") => {
    const client = getClient(provider);
    const fullPrompt =
      (extraInstruction ? `${extraInstruction}\n\n` : "") + "Receipt:\n" + cleaned;
    return withRetry(
      async () => {
        const res = await client.chat.completions.create({
          model: provider.model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: fullPrompt },
          ],
          response_format: { type: "json_object" },
          temperature: 0.1,
        });
        return res.choices[0]?.message?.content ?? "";
      },
      { label: provider.label, attempts: 2, baseDelayMs: 1000 },
    );
  });
}

export async function parseWithAiFree(
  bytes: Uint8Array,
  mimeType: string,
): Promise<ParsedReceipt> {
  const providers = mediaProviders(mimeType);
  const base64 = Buffer.from(bytes).toString("base64");
  const dataUrl = `data:${mimeType};base64,${base64}`;

  return tryProviders(providers, "AI-free media", async (provider, extraInstruction = "") => {
    const client = getClient(provider);
    return withRetry(
      async () => {
        const res = await client.chat.completions.create({
          model: provider.model,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: SYSTEM_PROMPT + (extraInstruction ? `\n\n${extraInstruction}` : "") },
                { type: "image_url", image_url: { url: dataUrl } },
              ],
            },
          ],
          response_format: { type: "json_object" },
          temperature: 0.1,
        });
        return res.choices[0]?.message?.content ?? "";
      },
      { label: provider.label, attempts: 2, baseDelayMs: 1000 },
    );
  });
}
