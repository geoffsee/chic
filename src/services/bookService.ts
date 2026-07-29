import { prepareGutenbergText } from "./gutenbergText";
import { FALLBACK_CATALOG } from "./fallbackCatalog";

/** Lean catalog entry returned by the API (no Gutendex metadata blobs). */
export type BookSummary = {
  id: string;
  title: string;
  authors: string[];
  sourceLabel: string;
  description?: string;
  textUrl?: string;
};

export type CatalogPage = {
  books: BookSummary[];
  page: number;
  count: number;
  nextPage: number | null;
  search: string;
};

export type ListBooksOptions = {
  forceReload?: boolean;
  page?: number;
  search?: string;
};

export interface BookSource {
  label: string;
  listBooks(options?: ListBooksOptions): Promise<CatalogPage>;
  fetchBookText(book: BookSummary): Promise<string>;
}

/** Trailing slash avoids a 301 that some clients mishandle. */
const GUTENDEX_ENDPOINT = "https://gutendex.com/books/";
const USER_AGENT = "chic/1.0 (+https://seemueller.com/chic)";
const CATALOG_FETCH_TIMEOUT_MS = 15_000;
const TEXT_FETCH_TIMEOUT_MS = 45_000;
const PAGE_SIZE = 32;

const TEXT_FORMAT_PRIORITY = [
  "text/plain; charset=utf-8",
  "text/plain",
  "text/plain; charset=us-ascii",
];

const CATALOG_CACHE_TTL = 1000 * 60 * 15; // 15 minutes
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
  count: number;
  next: string | null;
  previous: string | null;
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

const buildFallbackTextUrl = (id: number | string) => {
  const numeric = typeof id === "number" ? id : Number(id);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return `https://www.gutenberg.org/cache/epub/${numeric}/pg${numeric}.txt`;
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

const toBookSummary = (book: GutendexBook): BookSummary => ({
  id: String(book.id),
  title: book.title,
  authors: book.authors
    .map((author) => author.name)
    .filter((name): name is string => Boolean(name)),
  sourceLabel: "Project Gutenberg",
  description: describeBook(book),
  textUrl: pickTextUrl(book.formats) ?? buildFallbackTextUrl(book.id) ?? undefined,
});

const normalizeSearch = (value?: string) =>
  (value ?? "").trim().replace(/\s+/g, " ").slice(0, 120);

const matchesSearch = (book: BookSummary, search: string) => {
  if (!search) {
    return true;
  }
  const needle = search.toLowerCase();
  if (book.title.toLowerCase().includes(needle)) {
    return true;
  }
  return book.authors.some((author) => author.toLowerCase().includes(needle));
};

const fallbackPage = (page: number, search: string): CatalogPage => {
  const filtered = FALLBACK_CATALOG.filter((book) => matchesSearch(book, search));
  const start = (page - 1) * PAGE_SIZE;
  const slice = filtered.slice(start, start + PAGE_SIZE);
  const hasMore = start + slice.length < filtered.length;
  return {
    books: slice.map((book) => ({ ...book })),
    page,
    count: filtered.length,
    nextPage: hasMore ? page + 1 : null,
    search,
  };
};

export class ProjectGutenbergBookSource implements BookSource {
  label = "Project Gutenberg";

  private catalogCache = new Map<string, CacheEntry<CatalogPage>>();
  private catalogPromises = new Map<string, Promise<CatalogPage>>();

  private textCache = new Map<string, CacheEntry<string>>();
  private textPromises = new Map<string, Promise<string>>();

  async listBooks(options?: ListBooksOptions): Promise<CatalogPage> {
    const page = Math.max(1, options?.page ?? 1);
    const search = normalizeSearch(options?.search);
    const cacheKey = `p=${page}:q=${search.toLowerCase()}`;
    const shouldBypassCache = options?.forceReload ?? false;

    if (!shouldBypassCache) {
      const cached = this.catalogCache.get(cacheKey);
      if (isCacheFresh(cached)) {
        return cached!.value;
      }
    }

    const pending = this.catalogPromises.get(cacheKey);
    if (pending) {
      return pending;
    }

    const promise = this.fetchCatalogPage(page, search)
      .then((result) => {
        this.catalogCache.set(cacheKey, {
          value: result,
          expiresAt: Date.now() + CATALOG_CACHE_TTL,
        });
        return result;
      })
      .finally(() => {
        this.catalogPromises.delete(cacheKey);
      });

    this.catalogPromises.set(cacheKey, promise);
    return promise;
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

  private async fetchCatalogPage(page: number, search: string): Promise<CatalogPage> {
    try {
      const url = new URL(GUTENDEX_ENDPOINT);
      url.searchParams.set("languages", "en");
      url.searchParams.set("mime_type", "text/plain");
      url.searchParams.set("sort", "downloads");
      url.searchParams.set("page", String(page));
      if (search) {
        url.searchParams.set("search", search);
      }

      const response = await fetchWithTimeout(url, CATALOG_FETCH_TIMEOUT_MS, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(`Gutendex responded with ${response.status}`);
      }

      const payload = (await response.json()) as GutendexResponse;
      if (!Array.isArray(payload?.results)) {
        throw new Error("Gutendex returned an invalid catalog.");
      }

      return {
        books: payload.results.map(toBookSummary),
        page,
        count: typeof payload.count === "number" ? payload.count : payload.results.length,
        nextPage: payload.next ? page + 1 : null,
        search,
      };
    } catch (error) {
      if (page === 1) {
        console.warn(
          "[catalog] Gutendex unavailable, using curated fallback:",
          error instanceof Error ? error.message : error,
        );
        return fallbackPage(page, search);
      }
      throw error instanceof Error ? error : new Error("Unable to load more books.");
    }
  }

  private async fetchText(book: BookSummary): Promise<string> {
    const textUrl = book.textUrl ?? buildFallbackTextUrl(book.id);
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

const isCatalogPage = (value: unknown): value is CatalogPage => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return Array.isArray(record.books);
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

  async listBooks(options?: ListBooksOptions): Promise<CatalogPage> {
    const page = Math.max(1, options?.page ?? 1);
    const search = normalizeSearch(options?.search);
    const params = new URLSearchParams();
    params.set("page", String(page));
    if (search) {
      params.set("search", search);
    }
    if (options?.forceReload) {
      params.set("force", "true");
    }

    try {
      const payload = await this.fetchJson<CatalogPage | BookSummary[] | { error?: string }>(
        `/api/gutenberg-books?${params.toString()}`,
      );

      if (isCatalogPage(payload)) {
        return {
          books: payload.books,
          page: typeof payload.page === "number" ? payload.page : page,
          count: typeof payload.count === "number" ? payload.count : payload.books.length,
          nextPage:
            payload.nextPage === null || typeof payload.nextPage === "number"
              ? payload.nextPage
              : null,
          search: typeof payload.search === "string" ? payload.search : search,
        };
      }

      // Legacy array response (older API) — treat as a single page.
      if (Array.isArray(payload) && payload.length > 0) {
        return {
          books: payload,
          page: 1,
          count: payload.length,
          nextPage: null,
          search,
        };
      }

      if (payload && typeof payload === "object" && "error" in payload && payload.error) {
        throw new Error(String(payload.error));
      }
      throw new Error("Catalog response was empty.");
    } catch (error) {
      if (page === 1) {
        console.warn(
          "[catalog] API catalog failed, using curated fallback:",
          error instanceof Error ? error.message : error,
        );
        return fallbackPage(page, search);
      }
      throw error instanceof Error ? error : new Error("Unable to load more books.");
    }
  }

  async fetchBookText(book: BookSummary): Promise<string> {
    const response = await fetchWithTimeout("/api/book-text", TEXT_FETCH_TIMEOUT_MS, {
      method: "POST",
      body: JSON.stringify({
        id: book.id,
        textUrl: book.textUrl,
      }),
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
