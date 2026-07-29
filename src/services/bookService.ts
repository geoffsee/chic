import { prepareGutenbergText } from "./gutenbergText";
import { FALLBACK_CATALOG } from "./fallbackCatalog";

export type BookSummary = {
  id: string;
  title: string;
  authors: string[];
  sourceLabel: string;
  description?: string;
  metadata?: GutendexBook;
  textUrl?: string;
};

export interface BookSource {
  label: string;
  listBooks(options?: { forceReload?: boolean }): Promise<BookSummary[]>;
  fetchBookText(book: BookSummary): Promise<string>;
}

/** Trailing slash avoids a 301 that some clients mishandle. */
const GUTENDEX_ENDPOINT = "https://gutendex.com/books/";
const USER_AGENT = "chic/1.0 (+https://seemueller.com/chic)";
const CATALOG_FETCH_TIMEOUT_MS = 10_000;
const TEXT_FETCH_TIMEOUT_MS = 45_000;

const TEXT_FORMAT_PRIORITY = [
  "text/plain; charset=utf-8",
  "text/plain",
  "text/plain; charset=us-ascii",
];

const CATALOG_CACHE_TTL = 1000 * 60 * 5; // 5 minutes
const BOOK_TEXT_CACHE_TTL = 1000 * 60 * 60; // 1 hour

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const isCacheFresh = (entry?: CacheEntry<unknown>) =>
  Boolean(entry && entry.expiresAt > Date.now());

type GutendexBook = {
  id: number;
  title: string;
  authors: { name: string | null }[];
  formats: Record<string, string | null>;
  bookshelves?: string[];
  subjects?: string[];
};

type GutendexResponse = {
  results: GutendexBook[];
};

const pickTextUrl = (formats: Record<string, string | null> = {}) => {
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

const buildFallbackTextUrl = (book?: GutendexBook) => {
  if (!book) {
    return null;
  }
  return `https://www.gutenberg.org/cache/epub/${book.id}/pg${book.id}.txt`;
};

const describeBook = (book: GutendexBook) => {
  const buckets: string[] = [];
  if (book.bookshelves?.length) {
    buckets.push(...book.bookshelves.slice(0, 2));
  }
  if (book.subjects?.length) {
    buckets.push(...book.subjects.slice(0, 2));
  }
  return buckets.length ? buckets.join(" · ") : undefined;
};

export class ProjectGutenbergBookSource implements BookSource {
  label = "Project Gutenberg";

  private catalogCache?: CacheEntry<BookSummary[]>;
  private catalogPromise?: Promise<BookSummary[]>;

  private textCache = new Map<string, CacheEntry<string>>();
  private textPromises = new Map<string, Promise<string>>();

  async listBooks(options?: { forceReload?: boolean }): Promise<BookSummary[]> {
    const shouldBypassCache = options?.forceReload ?? false;
    if (!shouldBypassCache && isCacheFresh(this.catalogCache)) {
      return this.catalogCache!.value;
    }

    if (this.catalogPromise) {
      return this.catalogPromise;
    }

    this.catalogPromise = this.fetchCatalog().finally(() => {
      this.catalogPromise = undefined;
    });

    return this.catalogPromise;
  }

  async fetchBookText(book: BookSummary): Promise<string> {
    const cacheKey = book.id;
    const cached = this.textCache.get(cacheKey);
    if (isCacheFresh(cached)) {
      return cached!.value;
    }

    const pending = this.textPromises.get(cacheKey);
    if (pending) {
      return pending;
    }

    const promise = this.fetchText(book).finally(() => {
      this.textPromises.delete(cacheKey);
    });

    this.textPromises.set(cacheKey, promise);
    return promise;
  }

  private cacheCatalog(books: BookSummary[]) {
    this.catalogCache = {
      value: books,
      expiresAt: Date.now() + CATALOG_CACHE_TTL,
    };
    return books;
  }

  private async fetchCatalog(): Promise<BookSummary[]> {
    try {
      const url = new URL(GUTENDEX_ENDPOINT);
      url.searchParams.set("languages", "en");
      url.searchParams.set("mime_type", "text/plain");
      url.searchParams.set("sort", "downloads");

      const response = await fetchWithTimeout(url, CATALOG_FETCH_TIMEOUT_MS, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(`Gutendex responded with ${response.status}`);
      }

      const payload = (await response.json()) as GutendexResponse;
      if (!Array.isArray(payload?.results) || payload.results.length === 0) {
        throw new Error("Gutendex returned an empty catalog.");
      }

      return this.cacheCatalog(
        payload.results.slice(0, 12).map((book) => ({
          id: String(book.id),
          title: book.title,
          authors: book.authors
            .map((author) => author.name)
            .filter((name): name is string => Boolean(name)),
          sourceLabel: this.label,
          description: describeBook(book),
          metadata: book,
          textUrl: pickTextUrl(book.formats) ?? buildFallbackTextUrl(book) ?? undefined,
        })),
      );
    } catch (error) {
      console.warn(
        "[catalog] Gutendex unavailable, using curated fallback:",
        error instanceof Error ? error.message : error,
      );
      return this.cacheCatalog(FALLBACK_CATALOG.map((book) => ({ ...book })));
    }
  }

  private async fetchText(book: BookSummary): Promise<string> {
    const textUrl = book.textUrl ?? buildFallbackTextUrl(book.metadata) ?? buildFallbackTextUrl({
      id: Number(book.id),
      title: book.title,
      authors: [],
      formats: {},
    });
    if (!textUrl) {
      throw new Error("Could not determine a text version for this book.");
    }

    const response = await fetchWithTimeout(textUrl, TEXT_FETCH_TIMEOUT_MS, {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!response.ok) {
      throw new Error("Failed to download the book text.");
    }

    const text = prepareGutenbergText(await response.text());
    this.textCache.set(book.id, {
      value: text,
      expiresAt: Date.now() + BOOK_TEXT_CACHE_TTL,
    });
    return text;
  }
}

const fetchWithTimeout = async (
  input: RequestInfo | URL,
  timeoutMs: number,
  init?: RequestInit,
): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

const ensureJson = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const createError = async (response: Response, fallback: string) => {
  let detail = fallback;

  try {
    const body = await response.json();
    if (ensureJson(body) && typeof body.error === "string") {
      detail = body.error;
    }
  } catch {
    // ignore parse errors, use fallback
  }

  return new Error(detail);
};

export class ApiBookSource implements BookSource {
  label = "Project Gutenberg";

  private async fetchJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
    const response = await fetchWithTimeout(input, CATALOG_FETCH_TIMEOUT_MS, init);
    if (!response.ok) {
      throw await createError(response, "Unable to reach the catalog.");
    }

    const contentType = response.headers.get("content-type") ?? "";
    // Mis-routed SPA HTML looks like 200 + text/html — treat as failure.
    if (contentType.includes("text/html")) {
      throw new Error("Catalog API returned a web page instead of JSON. Is the server running?");
    }

    const payload = (await response.json()) as unknown;
    return payload as T;
  }

  async listBooks(options?: { forceReload?: boolean }): Promise<BookSummary[]> {
    const query = options?.forceReload ? "?force=true" : "";
    try {
      const payload = await this.fetchJson<BookSummary[] | { error?: string }>(
        `/api/gutenberg-books${query}`,
      );
      if (Array.isArray(payload) && payload.length > 0) {
        return payload;
      }
      if (payload && typeof payload === "object" && "error" in payload && payload.error) {
        throw new Error(String(payload.error));
      }
      throw new Error("Catalog response was empty.");
    } catch (error) {
      console.warn(
        "[catalog] API catalog failed, using curated fallback:",
        error instanceof Error ? error.message : error,
      );
      return FALLBACK_CATALOG.map((book) => ({ ...book }));
    }
  }

  async fetchBookText(book: BookSummary): Promise<string> {
    const response = await fetchWithTimeout("/api/book-text", TEXT_FETCH_TIMEOUT_MS, {
      method: "POST",
      body: JSON.stringify(book),
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      throw await createError(response, "Unable to load the book text.");
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("text/html")) {
      throw new Error("Book text API returned a web page instead of plain text.");
    }

    return response.text();
  }
}
