import type { BookTextPage } from "./library";

/** Default characters per page returned to the client. */
export const DEFAULT_BOOK_TEXT_PAGE_CHARS = 8_000;

/**
 * Soft-break a page near `targetEnd` so we prefer paragraph / line / word
 * boundaries instead of mid-word cuts.
 */
export function findSoftBreak(text: string, targetEnd: number, minEnd: number): number {
  if (targetEnd >= text.length) {
    return text.length;
  }

  const windowStart = Math.max(minEnd, targetEnd - 400);
  const window = text.slice(windowStart, targetEnd + 1);

  const paragraph = window.lastIndexOf("\n\n");
  if (paragraph >= 0) {
    return windowStart + paragraph + 2;
  }

  const line = window.lastIndexOf("\n");
  if (line >= 0) {
    return windowStart + line + 1;
  }

  const space = window.lastIndexOf(" ");
  if (space >= 0) {
    return windowStart + space + 1;
  }

  return targetEnd;
}

/**
 * Build page boundaries (exclusive end offsets) for a full prepared book.
 * Pure — safe to unit test without network or KV.
 */
export function buildPageEnds(
  fullText: string,
  pageChars: number = DEFAULT_BOOK_TEXT_PAGE_CHARS,
): number[] {
  if (!fullText) {
    return [0];
  }
  if (pageChars < 1) {
    throw new Error("pageChars must be >= 1");
  }

  const ends: number[] = [];
  let start = 0;
  while (start < fullText.length) {
    const rawEnd = Math.min(start + pageChars, fullText.length);
    const minEnd = start + Math.floor(pageChars * 0.5);
    const end = findSoftBreak(fullText, rawEnd, minEnd);
    ends.push(end);
    start = end;
  }
  return ends;
}

/** Page payload before a library stamps its id. */
export type BookTextPageChunk = Omit<BookTextPage, "libraryId">;

/**
 * Slice one 1-based page from a full prepared book stored in KV.
 */
export function getBookTextPage(
  fullText: string,
  bookId: string,
  page: number,
  pageChars: number = DEFAULT_BOOK_TEXT_PAGE_CHARS,
): BookTextPageChunk {
  const safePage = Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1;
  const ends = buildPageEnds(fullText, pageChars);
  const totalPages = Math.max(1, ends.length);
  const clampedPage = Math.min(safePage, totalPages);
  const start = clampedPage === 1 ? 0 : ends[clampedPage - 2]!;
  const end = ends[clampedPage - 1] ?? fullText.length;
  const text = fullText.slice(start, end);

  return {
    id: bookId,
    page: clampedPage,
    text,
    nextPage: clampedPage < totalPages ? clampedPage + 1 : null,
    totalPages,
    totalChars: fullText.length,
    start,
    end,
  };
}
