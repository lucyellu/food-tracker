import "server-only";

import {
  detectWebWithGoogleVision,
  isGoogleVisionReverseImageSearchConfigured,
} from "@/lib/ocr/google-vision";

export type ReverseImageSourcePage = {
  title: string | null;
  url: string;
};

export type ReverseImageSearchResult = {
  provider: "google_vision_web_detection";
  configured: boolean;
  bestGuessLabels: string[];
  webEntities: Array<{ description: string; score: number | null }>;
  pages: ReverseImageSourcePage[];
  fullMatchingImages: string[];
  partialMatchingImages: string[];
  visuallySimilarImages: string[];
  queryText: string | null;
  fallbackText: string | null;
};

type ImageUrlEntry = {
  url?: string;
};

function cleanText(value: string | null | undefined) {
  const text = value?.replace(/\s+/g, " ").trim();
  return text ? text : null;
}

function cleanUrl(value: string | null | undefined) {
  const url = value?.trim();
  if (!url || !/^https?:\/\//i.test(url)) return null;
  return url;
}

function uniqueStrings(values: Array<string | null | undefined>, max = 12) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const cleaned = cleanText(value);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
    if (out.length >= max) break;
  }
  return out;
}

function uniqueUrls(values: ImageUrlEntry[] | undefined, max = 12) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of values ?? []) {
    const url = cleanUrl(entry.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
    if (out.length >= max) break;
  }
  return out;
}

function fallbackTextFor(result: Omit<ReverseImageSearchResult, "fallbackText">) {
  const lines = [
    result.queryText ? `Best visual guess: ${result.queryText}` : null,
    result.webEntities.length
      ? `Likely product/entity terms: ${result.webEntities.map((entity) => entity.description).join(", ")}`
      : null,
    result.pages.length
      ? `Matching pages: ${result.pages
          .slice(0, 6)
          .map((page) => [page.title, page.url].filter(Boolean).join(" - "))
          .join("; ")}`
      : null,
  ].filter(Boolean);

  return lines.length ? lines.join("\n") : null;
}

export function reverseImageSearchConfigured() {
  return isGoogleVisionReverseImageSearchConfigured();
}

export async function reverseGoogleImageSearch(bytes: Uint8Array, mimeType: string): Promise<ReverseImageSearchResult> {
  if (!reverseImageSearchConfigured() || mimeType === "application/pdf") {
    return {
      provider: "google_vision_web_detection",
      configured: false,
      bestGuessLabels: [],
      webEntities: [],
      pages: [],
      fullMatchingImages: [],
      partialMatchingImages: [],
      visuallySimilarImages: [],
      queryText: null,
      fallbackText: null,
    };
  }

  const detection = await detectWebWithGoogleVision(bytes, mimeType, 12);
  const bestGuessLabels = uniqueStrings(detection?.bestGuessLabels?.map((label) => label.label) ?? [], 8);
  const webEntities = (detection?.webEntities ?? [])
    .map((entity) => ({
      description: cleanText(entity.description),
      score: typeof entity.score === "number" && Number.isFinite(entity.score) ? entity.score : null,
    }))
    .filter((entity): entity is { description: string; score: number | null } => Boolean(entity.description))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 12);
  const pages = (detection?.pagesWithMatchingImages ?? [])
    .map((page) => ({
      title: cleanText(page.pageTitle),
      url: cleanUrl(page.url),
    }))
    .filter((page): page is ReverseImageSourcePage => Boolean(page.url))
    .slice(0, 10);

  const queryText = uniqueStrings(
    [...bestGuessLabels, ...webEntities.map((entity) => entity.description), ...pages.map((page) => page.title)],
    10,
  ).join(" ");

  const result = {
    provider: "google_vision_web_detection" as const,
    configured: true,
    bestGuessLabels,
    webEntities,
    pages,
    fullMatchingImages: uniqueUrls(detection?.fullMatchingImages, 10),
    partialMatchingImages: uniqueUrls(detection?.partialMatchingImages, 10),
    visuallySimilarImages: uniqueUrls(detection?.visuallySimilarImages, 10),
    queryText: queryText || null,
  };

  return {
    ...result,
    fallbackText: fallbackTextFor(result),
  };
}
