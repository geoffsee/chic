import { FALLBACK_CATALOG } from "../../src/services/fallbackCatalog";

type KVNamespace = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
};

type GutendexBook = {
  id: number;
  title: string;
  authors: { name: string | null }[];
  formats: Record<string, string | null>;
  bookshelves?: string[];
  subjects?: string[];
};

/** Lean catalog entry — no Gutendex formats/metadata blobs. */
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

type Env = {
  GUTENBERG_KV: KVNamespace;
};

const GUTENDEX_ENDPOINT = "https://gutendex.com/books/";
const CATALOG_FETCH_TIMEOUT_MS = 15_000;
const TEXT_FORMAT_PRIORITY = [
  "text/plain; charset=utf-8",
  "text/plain",
  "text/plain; charset=us-ascii",
];
const CATALOG_TTL = 60 * 15; // 15 minutes
/** Bump when response shape changes so KV never serves stale payloads. */
const CACHE_VERSION = "v3";
const PAGE_SIZE = 32;

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

const buildFallbackTextUrl = (id: number) =>
  `https://www.gutenberg.org/cache/epub/${id}/pg${id}.txt`;

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
  textUrl: pickTextUrl(book.formats) ?? buildFallbackTextUrl(book.id),
});

const USER_AGENT = "chic/1.0 (+https://chic.geoffsee.com)";

const fetchWithHeaders = async (input: RequestInfo, init?: RequestInit) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CATALOG_FETCH_TIMEOUT_MS);
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
        ...(init?.headers ?? {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
};

const normalizeSearch = (value: string | null) =>
  (value ?? "").trim().replace(/\s+/g, " ").slice(0, 120);

const parsePage = (value: string | null) => {
  const parsed = Number.parseInt(value ?? "1", 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 1;
  }
  return Math.min(parsed, 10_000);
};

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

const cacheKeyFor = (page: number, search: string) =>
  `catalog:${CACHE_VERSION}:p=${page}:q=${encodeURIComponent(search.toLowerCase())}`;

export const handleGutenbergBooks = async (request: Request, env: Env) => {
  const requestUrl = new URL(request.url);
  const forceReload = requestUrl.searchParams.get("force") === "true";
  const page = parsePage(requestUrl.searchParams.get("page"));
  const search = normalizeSearch(requestUrl.searchParams.get("search"));
  const cacheKey = cacheKeyFor(page, search);

  if (!forceReload) {
    const cached = await env.GUTENBERG_KV.get(cacheKey);
    if (cached) {
      return new Response(cached, {
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }
  }

  const endpoint = new URL(GUTENDEX_ENDPOINT);
  endpoint.searchParams.set("languages", "en");
  endpoint.searchParams.set("mime_type", "text/plain");
  endpoint.searchParams.set("sort", "downloads");
  endpoint.searchParams.set("page", String(page));
  if (search) {
    endpoint.searchParams.set("search", search);
  }

  try {
    const response = await fetchWithHeaders(endpoint.toString());
    if (!response.ok) {
      throw new Error(`Gutendex status ${response.status}`);
    }

    const payload = (await response.json()) as {
      count?: number;
      next?: string | null;
      results?: GutendexBook[];
    };
    if (!Array.isArray(payload.results)) {
      throw new Error("invalid results");
    }

    const books = payload.results.map(toBookSummary);
    const count = typeof payload.count === "number" ? payload.count : books.length;
    const nextPage = payload.next ? page + 1 : null;
    const body: CatalogPage = {
      books,
      page,
      count,
      nextPage,
      search,
    };
    const serialized = JSON.stringify(body);
    await env.GUTENBERG_KV.put(cacheKey, serialized, { expirationTtl: CATALOG_TTL });

    return new Response(serialized, {
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch {
    // First page: prefer a usable offline list over a hard 502.
    // Later pages: surface the failure so infinite scroll does not look "finished".
    if (page === 1) {
      const body = JSON.stringify(fallbackPage(page, search));
      return new Response(body, {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "X-Catalog-Source": "fallback",
        },
      });
    }

    return new Response(JSON.stringify({ error: "Unable to load more books." }), {
      status: 502,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
};
