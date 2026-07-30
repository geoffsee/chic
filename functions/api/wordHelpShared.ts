/** Shared helpers for word-info / word-image Workers handlers. */

export type KvNamespace = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
};

export type AiBinding = {
  run: (
    model: string,
    inputs: Record<string, unknown>,
    options?: { returnRawResponse?: boolean },
  ) => Promise<Response | ReadableStream | ArrayBuffer | Uint8Array | unknown>;
};

export type WordHelpEnv = {
  GUTENBERG_KV: KvNamespace;
  AI?: AiBinding;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
};

export const WORD_INFO_TTL = 60 * 60 * 24; // 1 day
export const WORD_IMAGE_TTL = 60 * 60 * 24 * 7; // 7 days

export const TEXT_MODEL = "@cf/meta/llama-3.1-8b-instruct";
export const IMAGE_MODEL = "@cf/black-forest-labs/flux-1-schnell";

/** Function words / noise we skip illustrating to save cost. */
const IMAGE_SKIP = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "if",
  "of",
  "to",
  "in",
  "on",
  "at",
  "for",
  "by",
  "with",
  "from",
  "as",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "it",
  "its",
  "this",
  "that",
  "these",
  "those",
  "i",
  "you",
  "he",
  "she",
  "we",
  "they",
  "me",
  "him",
  "her",
  "us",
  "them",
  "my",
  "your",
  "his",
  "our",
  "their",
]);

export const normalizeWord = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/^[^a-z0-9']+|[^a-z0-9']+$/gi, "");

export const capitalize = (value: string) =>
  value ? value.charAt(0).toUpperCase() + value.slice(1) : value;

export const primaryLocale = (value: string | null | undefined): string => {
  if (!value || typeof value !== "string") {
    return "en";
  }
  const primary = value.trim().toLowerCase().split(/[-_]/)[0] ?? "en";
  return primary || "en";
};

export const shouldSkipImage = (word: string): boolean => {
  const normalized = normalizeWord(word);
  if (normalized.length < 2) {
    return true;
  }
  if (!/[a-z]/i.test(normalized)) {
    return true;
  }
  return IMAGE_SKIP.has(normalized);
};

export const wordInfoCacheKey = (locale: string, word: string) =>
  `word-info:v2:${primaryLocale(locale)}:${normalizeWord(word)}`;

export const wordImageCacheKey = (word: string) => `word-image:v1:${normalizeWord(word)}`;

export const buildImagePrompt = (word: string, definition?: string, partOfSpeech?: string) => {
  const parts = [
    `Simple clear illustration of the concept "${word}" for a dictionary card.`,
    "Clean composition, soft lighting, no text letters in the image, no watermark, no letters, no writing.",
  ];
  if (partOfSpeech) {
    parts.push(`Part of speech: ${partOfSpeech}.`);
  }
  if (definition) {
    const snippet = definition.length > 160 ? `${definition.slice(0, 160).trim()}…` : definition;
    parts.push(`Sense: ${snippet}`);
  }
  return parts.join(" ");
};

export const readProcessEnv = (key: string): string | undefined => {
  try {
    return typeof process !== "undefined" ? process.env?.[key] : undefined;
  } catch {
    return undefined;
  }
};

/** Extract assistant text from common Workers AI chat / text response shapes. */
export const extractAiText = (result: unknown): string | null => {
  if (typeof result === "string" && result.trim()) {
    return result.trim();
  }
  if (!result || typeof result !== "object") {
    return null;
  }
  const record = result as Record<string, unknown>;
  if (typeof record.response === "string" && record.response.trim()) {
    return record.response.trim();
  }
  if (typeof record.result === "string" && record.result.trim()) {
    return record.result.trim();
  }
  if (typeof record.text === "string" && record.text.trim()) {
    return record.text.trim();
  }
  const nested = record.result;
  if (nested && typeof nested === "object") {
    const nestedRecord = nested as Record<string, unknown>;
    if (typeof nestedRecord.response === "string" && nestedRecord.response.trim()) {
      return nestedRecord.response.trim();
    }
  }
  return null;
};

export const extractFluxImageBase64 = (result: unknown): string | null => {
  if (!result || typeof result !== "object") {
    return null;
  }
  const record = result as Record<string, unknown>;
  if (typeof record.image === "string" && record.image.length > 0) {
    return record.image;
  }
  const nested = record.result;
  if (nested && typeof nested === "object") {
    const nestedRecord = nested as Record<string, unknown>;
    if (typeof nestedRecord.image === "string" && nestedRecord.image.length > 0) {
      return nestedRecord.image;
    }
  }
  return null;
};

export const toDataUri = (base64: string, mime = "image/jpeg") => {
  if (base64.startsWith("data:")) {
    return base64;
  }
  return `data:${mime};charset=utf-8;base64,${base64}`;
};
