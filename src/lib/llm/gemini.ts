import { GoogleGenerativeAI } from "@google/generative-ai";
import { SYSTEM_PROMPT, type ParsedReceipt } from "./schema";
import { tryParseReceipt, compressWhitespace } from "./util";

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
  const parsed = tryParseReceipt(raw);
  if (parsed.ok) return parsed.value;

  const retry = await callOnce(
    `Your previous response was invalid: ${parsed.error}\nReturn only valid JSON matching the schema.`,
  );
  const reparsed = tryParseReceipt(retry);
  if (reparsed.ok) return reparsed.value;

  throw new Error(`Gemini returned invalid JSON twice: ${reparsed.error}`);
}

export async function parseGeminiText(text: string): Promise<ParsedReceipt> {
  const model = getModel();
  const cleaned = compressWhitespace(text);

  const callOnce = async (extraInstruction = "") => {
    const fullPrompt =
      SYSTEM_PROMPT +
      (extraInstruction ? `\n\n${extraInstruction}` : "") +
      "\n\nReceipt:\n" +
      cleaned;
    const res = await model.generateContent(fullPrompt);
    return res.response.text();
  };

  const raw = await callOnce();
  const parsed = tryParseReceipt(raw);
  if (parsed.ok) return parsed.value;

  const retry = await callOnce(
    `Your previous response was invalid: ${parsed.error}\nReturn only valid JSON matching the schema.`,
  );
  const reparsed = tryParseReceipt(retry);
  if (reparsed.ok) return reparsed.value;

  throw new Error(`Gemini returned invalid JSON twice: ${reparsed.error}`);
}
