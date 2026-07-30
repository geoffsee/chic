import {
  getSharedLibraryRegistry,
  type CatalogPage,
  type LibraryId,
  type LibraryRegistry,
} from "../../src/services/library";

type KVNamespace = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
};

type Env = {
  GUTENBERG_KV: KVNamespace;
};

const CATALOG_TTL = 60 * 15; // 15 minutes
/** Bump when response shape changes so KV never serves stale payloads. */
const CACHE_VERSION = "v4";

const normalizeSearch = (value: string | null) =>
  (value ?? "").trim().replace(/\s+/g, " ").slice(0, 120);

const parsePage = (value: string | null) => {
  const parsed = Number.parseInt(value ?? "1", 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 1;
  }
  return Math.min(parsed, 10_000);
};

const cacheKeyFor = (libraryId: LibraryId, page: number, search: string) =>
  `catalog:${CACHE_VERSION}:${libraryId}:p=${page}:q=${encodeURIComponent(search.toLowerCase())}`;

export type BooksHandlerOptions = {
  /** Override registry (tests / multi-tenant). Defaults to process singleton. */
  registry?: LibraryRegistry;
  /** Force a library when the query omits `library` (legacy routes). */
  defaultLibraryId?: LibraryId;
};

/**
 * Generic catalog endpoint: `GET /api/books?library=gutenberg&page=1&search=…`
 *
 * Edge KV caches the JSON page per library; the live fetch is delegated to the
 * registered {@link Library} plugin.
 */
export const handleBooks = async (
  request: Request,
  env: Env,
  options: BooksHandlerOptions = {},
) => {
  const registry = options.registry ?? getSharedLibraryRegistry();
  const requestUrl = new URL(request.url);
  const forceReload = requestUrl.searchParams.get("force") === "true";
  const page = parsePage(requestUrl.searchParams.get("page"));
  const search = normalizeSearch(requestUrl.searchParams.get("search"));
  const requestedLibrary =
    requestUrl.searchParams.get("library") ??
    requestUrl.searchParams.get("source") ??
    options.defaultLibraryId ??
    undefined;

  let library;
  try {
    library = registry.require(requestedLibrary);
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown library.",
      }),
      {
        status: 400,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      },
    );
  }

  const cacheKey = cacheKeyFor(library.id, page, search);

  if (!forceReload) {
    const cached = await env.GUTENBERG_KV.get(cacheKey);
    if (cached) {
      return new Response(cached, {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "X-Library-Id": library.id,
        },
      });
    }
  }

  try {
    const body: CatalogPage = await library.listBooks({
      forceReload,
      page,
      search,
    });
    // Ensure libraryId is always present on the wire.
    if (!body.libraryId) {
      body.libraryId = library.id;
    }
    const serialized = JSON.stringify(body);
    await env.GUTENBERG_KV.put(cacheKey, serialized, { expirationTtl: CATALOG_TTL });

    return new Response(serialized, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "X-Library-Id": library.id,
      },
    });
  } catch (error) {
    // GutenbergLibrary already fails open on page 1; other libraries may throw.
    if (page === 1) {
      try {
        const body = await library.listBooks({ forceReload: true, page: 1, search });
        const serialized = JSON.stringify(body);
        return new Response(serialized, {
          status: 200,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "X-Library-Id": library.id,
            "X-Catalog-Source": "fallback",
          },
        });
      } catch {
        // fall through
      }
    }

    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unable to load more books.",
      }),
      {
        status: 502,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      },
    );
  }
};

/** List registered library plugins. */
export const handleLibraries = async (
  _request: Request,
  options: { registry?: LibraryRegistry } = {},
) => {
  const registry = options.registry ?? getSharedLibraryRegistry();
  return new Response(JSON.stringify({ libraries: registry.listMeta() }), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
};
