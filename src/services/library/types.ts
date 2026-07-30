/**
 * Pluggable book-source model.
 *
 * To add a catalog (Internet Archive, local OPDS, etc.):
 *   1. Subclass {@link Library}
 *   2. Register it with {@link LibraryRegistry}
 *   3. The API and UI resolve books by `libraryId`
 */

/** Stable id for a registered library plugin (e.g. `"gutenberg"`). */
export type LibraryId = string;

/** Lean catalog entry — no source-specific metadata blobs. */
export type BookSummary = {
  /** Source-local book id (unique only within its library). */
  id: string;
  /** Which {@link Library} owns this book. */
  libraryId: LibraryId;
  title: string;
  authors: string[];
  /** Human-readable source name for the UI. */
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
  libraryId: LibraryId;
};

export type ListBooksOptions = {
  forceReload?: boolean;
  page?: number;
  search?: string;
};

/** One page of prepared book text served from cache-backed storage. */
export type BookTextPage = {
  id: string;
  libraryId: LibraryId;
  page: number;
  text: string;
  nextPage: number | null;
  totalPages: number;
  totalChars: number;
  /** Inclusive start offset of this page in the full prepared text. */
  start: number;
  /** Exclusive end offset of this page in the full prepared text. */
  end: number;
};

export type FetchBookTextPageOptions = {
  page?: number;
};

/** Input for downloading / preparing full book text. */
export type BookTextRequest = {
  id: string;
  libraryId?: LibraryId;
  textUrl?: string;
  metadata?: {
    id?: number;
    formats?: Record<string, string | null>;
  };
};

/**
 * Stable key for progress, client selection, and multi-source maps.
 * Format: `"gutenberg:11"`.
 */
export function bookRefKey(book: Pick<BookSummary, "libraryId" | "id">): string {
  return `${book.libraryId}:${book.id}`;
}

/**
 * Abstract book source plugin.
 *
 * Server implementations also override {@link resolveTextCandidates} and
 * {@link prepareText} so `/api/book-text` can ingest without knowing the source.
 * Browser/remote clients only need catalog + paged text fetch.
 */
export abstract class Library {
  abstract readonly id: LibraryId;
  abstract readonly label: string;

  abstract listBooks(options?: ListBooksOptions): Promise<CatalogPage>;

  /** Load one page of prepared text (1-based). Does not return the full book. */
  abstract fetchBookTextPage(
    book: BookSummary,
    options?: FetchBookTextPageOptions,
  ): Promise<BookTextPage>;

  /**
   * Candidate plain-text download URLs for a book.
   * Server-side libraries must implement this; remote clients may leave the default.
   */
  resolveTextCandidates(_book: BookTextRequest): string[] {
    return [];
  }

  /**
   * Strip source-specific wrappers from raw downloaded text.
   * Default is identity (no transformation).
   */
  prepareText(raw: string): string {
    return raw;
  }

  /** KV / cache key for the full prepared text of a book in this library. */
  textCacheKey(bookId: string): string {
    return `text:v4:${this.id}:${bookId}`;
  }

  /** Lightweight descriptor for `/api/libraries`. */
  toMeta(): LibraryMeta {
    return { id: this.id, label: this.label };
  }
}

export type LibraryMeta = {
  id: LibraryId;
  label: string;
};
