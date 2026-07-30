import type { BookTextRequest } from "../types";
import { TEXT_FORMAT_PRIORITY } from "./constants";

export const pickTextUrl = (formats: Record<string, string | null> = {}) => {
  for (const key of TEXT_FORMAT_PRIORITY) {
    const candidate = formats[key];
    if (candidate) {
      return candidate;
    }
  }
  const fallback = Object.values(formats).find(
    (value) => typeof value === "string" && value.endsWith(".txt"),
  );
  return fallback ?? null;
};

export const buildFallbackTextUrl = (id?: number | string) => {
  const numeric = typeof id === "number" ? id : Number(id);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  return `https://www.gutenberg.org/cache/epub/${numeric}/pg${numeric}.txt`;
};

const normalizeUrl = (value?: string | null) => {
  if (!value) {
    return null;
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "http:") {
      parsed.protocol = "https:";
    }
    return parsed.toString();
  } catch {
    return null;
  }
};

/** Candidate plain-text URLs for a Gutenberg book (deduped, https). */
export function collectGutenbergTextCandidates(book: BookTextRequest): string[] {
  const seen = new Set<string>();
  const add = (value?: string | null) => {
    const normalized = normalizeUrl(value);
    if (normalized) {
      seen.add(normalized);
      seen.add(normalized.replace(/-0\.txt$/, ".txt"));
    }
  };

  add(book.textUrl);
  add(pickTextUrl(book.metadata?.formats));
  add(buildFallbackTextUrl(book.metadata?.id));
  add(buildFallbackTextUrl(book.id));
  return Array.from(seen);
}
