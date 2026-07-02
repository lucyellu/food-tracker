const VISION_ENDPOINT = "https://vision.googleapis.com/v1/images:annotate";

type VisionResponse = {
  responses?: Array<{
    fullTextAnnotation?: {
      text?: string;
    };
    textAnnotations?: Array<{
      description?: string;
    }>;
    webDetection?: {
      bestGuessLabels?: Array<{
        label?: string;
        languageCode?: string;
      }>;
      webEntities?: Array<{
        entityId?: string;
        score?: number;
        description?: string;
      }>;
      pagesWithMatchingImages?: Array<{
        url?: string;
        pageTitle?: string;
      }>;
      fullMatchingImages?: Array<{
        url?: string;
      }>;
      partialMatchingImages?: Array<{
        url?: string;
      }>;
      visuallySimilarImages?: Array<{
        url?: string;
      }>;
    };
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

export function isGoogleVisionReverseImageSearchConfigured() {
  return Boolean(getVisionApiKey());
}

async function annotateGoogleVision(
  bytes: Uint8Array,
  mimeType: string,
  features: Array<{ type: string; maxResults?: number }>,
) {
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
          features,
        },
      ],
    }),
  });

  const data = (await res.json()) as VisionResponse;
  const response = data.responses?.[0];
  const message = data.error?.message ?? response?.error?.message;
  if (!res.ok || message) {
    throw new Error(message || `Google Vision failed (${res.status})`);
  }

  return response ?? null;
}

export async function extractTextWithGoogleVision(bytes: Uint8Array, mimeType: string) {
  const response = await annotateGoogleVision(bytes, mimeType, [{ type: "DOCUMENT_TEXT_DETECTION" }]);

  return response?.fullTextAnnotation?.text ?? response?.textAnnotations?.[0]?.description ?? null;
}

export async function detectWebWithGoogleVision(bytes: Uint8Array, mimeType: string, maxResults = 10) {
  const response = await annotateGoogleVision(bytes, mimeType, [
    { type: "WEB_DETECTION", maxResults: Math.max(1, Math.min(maxResults, 20)) },
  ]);

  return response?.webDetection ?? null;
}
