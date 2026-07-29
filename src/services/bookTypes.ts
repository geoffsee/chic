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

/** One page of prepared book text served from KV-backed storage. */
export type BookTextPage = {
  id: string;
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

export interface BookSource {
  label: string;
  listBooks(options?: ListBooksOptions): Promise<CatalogPage>;
  /** Load one page of prepared text (1-based). Does not return the full book. */
  fetchBookTextPage(book: BookSummary, options?: FetchBookTextPageOptions): Promise<BookTextPage>;
}
