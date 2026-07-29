import { prepareGutenbergText } from "../../src/services/gutenbergText";

type KVNamespace = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
};

type GutendexBook = {
  id: number;
  title: string;
  authors: { name: string | null }[];
  formats: Record<string, string | null>;
};

type BookSummary = {
  id: string;
  textUrl?: string;
  metadata?: GutendexBook;
};

type Env = {
  GUTENBERG_KV: KVNamespace;
};

const TEXT_FORMAT_PRIORITY = [
  "text/plain; charset=utf-8",
  "text/plain",
  "text/plain; charset=us-ascii",
];

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

const TEXT_TTL = 60 * 60; // 1 hour
/** Bump when prepareGutenbergText output shape changes so KV doesn't serve old wrappers. */
const TEXT_CACHE_VERSION = "v2";

const USER_AGENT = "chic/1.0 (+https://seemueller.com/chic)";

const fetchWithHeaders = (input: RequestInfo, init?: RequestInit) =>
  fetch(input, {
    ...init,
    headers: {
      "User-Agent": USER_AGENT,
      ...(init?.headers ?? {}),
    },
  });

const buildFallbackTextUrl = (id?: number | string) => {
  const numeric = typeof id === "number" ? id : Number(id);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  return `https://www.gutenberg.org/cache/epub/${numeric}/pg${numeric}.txt`;
};

const normalizeUrl = (value?: string) => {
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

const collectTextCandidates = (book: BookSummary) => {
  const seen = new Set<string>();
  const add = (value?: string | null) => {
    const normalized = normalizeUrl(value ?? undefined);
    if (normalized) {
      seen.add(normalized);
      seen.add(normalized.replace(/-0\.txt$/, ".txt"));
    }
  };

  add(book.textUrl);
  add(pickTextUrl(book.metadata?.formats));
  add(buildFallbackTextUrl(book.metadata?.id));
  // Lean catalog responses omit metadata; still resolve plain text from the Gutenberg id.
  add(buildFallbackTextUrl(book.id));
  return Array.from(seen);
};

const ensureBookPayload = (value: unknown): value is BookSummary =>
  typeof value === "object" && value !== null && "id" in value;

export const handleBookText = async (request: Request, env: Env) => {
  const payload = await request.json().catch(() => null);
  if (!ensureBookPayload(payload)) {
    return new Response(
      JSON.stringify({ error: "Missing or invalid book information." }),
      { status: 400, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }

  const cacheKey = `text:${TEXT_CACHE_VERSION}:${payload.id}`;
  const cached = await env.GUTENBERG_KV.get(cacheKey);
  if (cached) {
    return new Response(cached, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const candidates = collectTextCandidates(payload);
  if (!candidates.length) {
    return new Response(
      JSON.stringify({ error: "Could not determine a text version for this book." }),
      { status: 400, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }

  let lastStatus = 502;
  let lastStatusText = "Unknown error";
  for (const textUrl of candidates) {
    const response = await fetchWithHeaders(textUrl);
    if (response.ok) {
      const text = prepareGutenbergText(await response.text());
      await env.GUTENBERG_KV.put(cacheKey, text, { expirationTtl: TEXT_TTL });
      return new Response(text, {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    lastStatus = response.status;
    lastStatusText = response.statusText;
  }

  const detail = `${lastStatus} ${lastStatusText}`;
  return new Response(
    JSON.stringify({
      error: "Failed to download the book text.",
      detail,
    }),
    { status: lastStatus, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
};
