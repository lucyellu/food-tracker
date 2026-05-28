const VISION_ENDPOINT = "https://vision.googleapis.com/v1/images:annotate";

type VisionResponse = {
  responses?: Array<{
    fullTextAnnotation?: {
      text?: string;
    };
    textAnnotations?: Array<{
      description?: string;
    }>;
    error?: {
      message?: string;
    };
  }>;
  error?: {
    message?: string;
  };
};

function getVisionApiKey() {
  return process.env.GOOGLE_CLOUD_VISION_API_KEY || process.env.GOOGLE_VISION_API_KEY || null;
}

export function isGoogleVisionOcrConfigured() {
  return Boolean(getVisionApiKey());
}

export async function extractTextWithGoogleVision(bytes: Uint8Array, mimeType: string) {
  const apiKey = getVisionApiKey();
  if (!apiKey || mimeType === "application/pdf") return null;

  const res = await fetch(`${VISION_ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      requests: [
        {
          image: {
            content: Buffer.from(bytes).toString("base64"),
          },
          features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
        },
      ],
    }),
  });

  const data = (await res.json()) as VisionResponse;
  const response = data.responses?.[0];
  const message = data.error?.message ?? response?.error?.message;
  if (!res.ok || message) {
    throw new Error(message || `Google Vision OCR failed (${res.status})`);
  }

  return response?.fullTextAnnotation?.text ?? response?.textAnnotations?.[0]?.description ?? null;
}
