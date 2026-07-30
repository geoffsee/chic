import type { BookTextRequest, Library } from "./library";

export type { BookTextRequest } from "./library";

export const BOOK_TEXT_CACHE_VERSION = "v4";
export const BOOK_TEXT_KV_TTL_SECONDS = 60 * 60 * 24; // 24 hours

const USER_AGENT = "chic/1.0 (+https://chic.geoffsee.com)";

/** @deprecated Prefer library.textCacheKey(bookId). Kept for call sites that already know the library id. */
export const bookTextCacheKey = (bookId: string, libraryId = "gutenberg") =>
  `text:${BOOK_TEXT_CACHE_VERSION}:${libraryId}:${bookId}`;

export type TextPipeline = Pick<Library, "resolveTextCandidates" | "prepareText">;

export type DownloadBookTextResult =
  | { ok: true; text: string }
  | { ok: false; status: number; statusText: string };

/**
 * Download raw book text via a library's pipeline, prepare the body, return it.
 */
export async function downloadAndPrepareBookText(
  book: BookTextRequest,
  pipeline: TextPipeline,
  fetchImpl: typeof fetch = fetch,
): Promise<DownloadBookTextResult> {
  const candidates = pipeline.resolveTextCandidates(book);
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
      return { ok: true, text: pipeline.prepareText(raw) };
    }
    lastStatus = response.status;
    lastStatusText = response.statusText;
  }

  return { ok: false, status: lastStatus, statusText: lastStatusText };
}
