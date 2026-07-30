import {
  BOOK_TEXT_KV_TTL_SECONDS,
  downloadAndPrepareBookText,
  type BookTextRequest,
} from "../../src/services/bookTextIngest";
import { getBookTextPage } from "../../src/services/bookTextChunk";
import {
  getSharedLibraryRegistry,
  type LibraryRegistry,
} from "../../src/services/library";

type KVNamespace = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
};

type Env = {
  GUTENBERG_KV: KVNamespace;
};

const parsePage = (value: unknown) => {
  const n = typeof value === "number" ? value : Number.parseInt(String(value ?? "1"), 10);
  if (!Number.isFinite(n) || n < 1) {
    return 1;
  }
  return Math.min(Math.floor(n), 100_000);
};

const ensureBookPayload = (value: unknown): value is BookTextRequest & { page?: number } =>
  typeof value === "object" &&
  value !== null &&
  "id" in value &&
  Boolean((value as BookTextRequest).id);

const json = (body: unknown, status = 200, extraHeaders?: Record<string, string>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });

export type BookTextHandlerOptions = {
  registry?: LibraryRegistry;
};

/**
 * Ensure the full prepared book lives in KV, then return one page to the client.
 * Library plugin owns URL candidates + text preparation.
 */
export const handleBookText = async (
  request: Request,
  env: Env,
  options: BookTextHandlerOptions = {},
) => {
  const registry = options.registry ?? getSharedLibraryRegistry();
  const payload = await request.json().catch(() => null);
  if (!ensureBookPayload(payload)) {
    return json({ error: "Missing or invalid book information." }, 400);
  }

  let library;
  try {
    library = registry.require(payload.libraryId);
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : "Unknown library." },
      400,
    );
  }

  const page = parsePage((payload as { page?: number }).page);
  const cacheKey = library.textCacheKey(String(payload.id));

  let fullText = await env.GUTENBERG_KV.get(cacheKey);
  let fromCache = Boolean(fullText);

  if (!fullText) {
    const downloaded = await downloadAndPrepareBookText(
      {
        id: String(payload.id),
        libraryId: library.id,
        textUrl: payload.textUrl,
        metadata: payload.metadata,
      },
      library,
    );
    if (!downloaded.ok) {
      if (downloaded.status === 400) {
        return json({ error: "Could not determine a text version for this book." }, 400);
      }
      return json(
        {
          error: "Failed to download the book text.",
          detail: `${downloaded.status} ${downloaded.statusText}`,
        },
        downloaded.status >= 400 ? downloaded.status : 502,
      );
    }
    fullText = downloaded.text;
    await env.GUTENBERG_KV.put(cacheKey, fullText, {
      expirationTtl: BOOK_TEXT_KV_TTL_SECONDS,
    });
    fromCache = false;
  }

  const chunk = getBookTextPage(fullText, String(payload.id), page);
  return json(
    { ...chunk, libraryId: library.id },
    200,
    {
      "X-Book-Text-Source": fromCache ? "kv" : "ingest",
      "X-Library-Id": library.id,
    },
  );
};
