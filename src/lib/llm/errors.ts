export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function isRateLimitError(error: unknown) {
  const message = errorMessage(error);
  return /\b429\b|too many requests|quota exceeded|rate[- ]?limit/i.test(message);
}

export function conciseParseError(error: unknown) {
  if (isRateLimitError(error)) {
    return "LLM quota/rate limit was hit. The scan stopped early so it does not keep spending calls on the same limit.";
  }
  return errorMessage(error);
}
