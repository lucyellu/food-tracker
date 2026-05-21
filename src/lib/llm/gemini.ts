import { GoogleGenerativeAI } from "@google/generative-ai";
import { SYSTEM_PROMPT, ParsedReceiptSchema, type ParsedReceipt } from "./schema";

function getModel() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set");
  }
  const genai = new GoogleGenerativeAI(apiKey);
  return genai.getGenerativeModel({
    model: "gemini-2.0-flash",
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.1,
    },
  });
}

export async function parseWithGemini(
  bytes: Uint8Array,
  mimeType: string,
): Promise<ParsedReceipt> {
  const model = getModel();
  const base64 = Buffer.from(bytes).toString("base64");

  const callOnce = async (extraInstruction = "") => {
    const res = await model.generateContent([
      { text: SYSTEM_PROMPT + (extraInstruction ? `\n\n${extraInstruction}` : "") },
      { inlineData: { mimeType, data: base64 } },
    ]);
    return res.response.text();
  };

  const raw = await callOnce();
  const parsed = tryParse(raw);
  if (parsed.ok) return parsed.value;

  const retry = await callOnce(
    `Your previous response was invalid: ${parsed.error}\nReturn only valid JSON matching the schema.`,
  );
  const reparsed = tryParse(retry);
  if (reparsed.ok) return reparsed.value;

  throw new Error(`Gemini returned invalid JSON twice: ${reparsed.error}`);
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
