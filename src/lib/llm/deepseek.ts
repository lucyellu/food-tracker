import OpenAI from "openai";
import { SYSTEM_PROMPT, ParsedReceiptSchema, type ParsedReceipt } from "./schema";

function getClient() {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY is not set");
  }
  return new OpenAI({
    apiKey,
    baseURL: "https://api.deepseek.com",
  });
}

export async function parseWithDeepSeek(text: string): Promise<ParsedReceipt> {
  const client = getClient();

  const callOnce = async (userContent: string) => {
    const res = await client.chat.completions.create({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
    });
    return res.choices[0]?.message?.content ?? "";
  };

  const raw = await callOnce(text);
  const parsed = tryParse(raw);
  if (parsed.ok) return parsed.value;

  const retry = await callOnce(
    `Your previous response was invalid:\n${parsed.error}\n\nThe receipt was:\n${text}\n\nReturn only valid JSON matching the schema.`,
  );
  const reparsed = tryParse(retry);
  if (reparsed.ok) return reparsed.value;

  throw new Error(`DeepSeek returned invalid JSON twice: ${reparsed.error}`);
}

function tryParse(raw: string): { ok: true; value: ParsedReceipt } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    return { ok: false, error: `JSON parse error: ${(e as Error).message}` };
  }
  const result = ParsedReceiptSchema.safeParse(json);
  if (!result.success) {
    return { ok: false, error: `Schema validation: ${result.error.message}` };
  }
  return { ok: true, value: result.data };
}
