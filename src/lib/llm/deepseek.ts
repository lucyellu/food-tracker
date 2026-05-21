import OpenAI from "openai";
import { SYSTEM_PROMPT, type ParsedReceipt } from "./schema";
import { tryParseReceipt, compressWhitespace } from "./util";

function getClient() {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY is not set");
  }
  return new OpenAI({
    apiKey,
    baseURL: "https://api.deepseek.com",
    timeout: 120_000,
  });
}

export async function parseWithDeepSeek(text: string): Promise<ParsedReceipt> {
  const client = getClient();
  const cleaned = compressWhitespace(text);

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

  const raw = await callOnce(cleaned);
  const parsed = tryParseReceipt(raw);
  if (parsed.ok) return parsed.value;

  const retry = await callOnce(
    `Your previous response was invalid:\n${parsed.error}\n\nThe receipt was:\n${cleaned}\n\nReturn only valid JSON matching the schema.`,
  );
  const reparsed = tryParseReceipt(retry);
  if (reparsed.ok) return reparsed.value;

  throw new Error(`DeepSeek returned invalid JSON twice: ${reparsed.error}`);
}
