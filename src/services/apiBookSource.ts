import type {
  BookSource,
  BookSummary,
  BookTextPage,
  CatalogPage,
  FetchBookTextPageOptions,
  ListBooksOptions,
} from "./bookTypes";
import { FALLBACK_CATALOG } from "./fallbackCatalog";

const CATALOG_FETCH_TIMEOUT_MS = 15_000;
const TEXT_FETCH_TIMEOUT_MS = 45_000;
const PAGE_SIZE = 32;

const normalizeSearch = (value?: string) => (value ?? "").trim().replace(/\s+/g, " ").slice(0, 120);

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
    // ignore parse errors
  }
  return new Error(detail);
};

const isCatalogPage = (value: unknown): value is CatalogPage => {
  if (!value || typeof value !== "object") {
    return false;
  }
  return Array.isArray((value as CatalogPage).books);
};

const isBookTextPage = (value: unknown): value is BookTextPage => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as BookTextPage;
  return typeof record.text === "string" && typeof record.page === "number";
};

/** Browser client — talks only to `/api/*` (paginated catalog + chunked text). */
export class ApiBookSource implements BookSource {
  label = "Project Gutenberg";

  private async fetchJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
    const response = await fetchWithTimeout(input, CATALOG_FETCH_TIMEOUT_MS, init);
    if (!response.ok) {
      throw await createError(response, "Unable to reach the catalog.");
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("text/html")) {
      throw new Error("Catalog API returned a web page instead of JSON. Is the server running?");
    }

    return (await response.json()) as T;
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

  async fetchBookTextPage(
    book: BookSummary,
    options?: FetchBookTextPageOptions,
  ): Promise<BookTextPage> {
    const page = Math.max(1, options?.page ?? 1);
    const response = await fetchWithTimeout("/api/book-text", TEXT_FETCH_TIMEOUT_MS, {
      method: "POST",
      body: JSON.stringify({
        id: book.id,
        textUrl: book.textUrl,
        page,
      }),
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      throw await createError(response, "Unable to load the book text.");
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("text/html")) {
      throw new Error("Book text API returned a web page instead of JSON.");
    }

    const payload = (await response.json()) as unknown;
    if (!isBookTextPage(payload)) {
      throw new Error("Book text API returned an invalid page payload.");
    }
    return payload;
  }
}
