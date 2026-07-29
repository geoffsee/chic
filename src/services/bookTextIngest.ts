import { prepareGutenbergText } from "./gutenbergText";

export type BookTextRequest = {
  id: string;
  textUrl?: string;
  metadata?: {
    id?: number;
    formats?: Record<string, string | null>;
  };
};

const TEXT_FORMAT_PRIORITY = [
  "text/plain; charset=utf-8",
  "text/plain",
  "text/plain; charset=us-ascii",
];

export const BOOK_TEXT_CACHE_VERSION = "v3";
export const BOOK_TEXT_KV_TTL_SECONDS = 60 * 60 * 24; // 24 hours
const USER_AGENT = "chic/1.0 (+https://chic.geoffsee.com)";

export const bookTextCacheKey = (bookId: string) => `text:${BOOK_TEXT_CACHE_VERSION}:${bookId}`;

const pickTextUrl = (formats?: Record<string, string | null>) => {
  if (!formats) {
    return null;
  }
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

/** Candidate plain-text URLs for a book request (deduped, https). */
export function collectTextCandidates(book: BookTextRequest): string[] {
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

export type DownloadBookTextResult =
  | { ok: true; text: string }
  | { ok: false; status: number; statusText: string };

/**
 * Download raw Gutenberg text, strip wrappers, return prepared body.
 */
export async function downloadAndPrepareBookText(
  book: BookTextRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<DownloadBookTextResult> {
  const candidates = collectTextCandidates(book);
  if (!candidates.length) {
    return { ok: false, status: 400, statusText: "No text URL candidates" };
  }

  let lastStatus = 502;
  let lastStatusText = "Unknown error";

  for (const textUrl of candidates) {
    const response = await fetchImpl(textUrl, {
      headers: { "User-Agent": USER_AGENT },
    });
    if (response.ok) {
      const raw = await response.text();
      return { ok: true, text: prepareGutenbergText(raw) };
    }
    lastStatus = response.status;
    lastStatusText = response.statusText;
  }

  return { ok: false, status: lastStatus, statusText: lastStatusText };
}
