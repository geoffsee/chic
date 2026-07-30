/**
 * Public surface for book catalog + text libraries.
 * Implementations live under `./library`.
 *
 * @example Add a new source
 * ```ts
 * class MyLibrary extends Library {
 *   readonly id = "my-source";
 *   readonly label = "My Source";
 *   async listBooks(options) { … }
 *   async fetchBookTextPage(book, options) { … }
 *   resolveTextCandidates(book) { … }
 *   prepareText(raw) { return raw; }
 * }
 * getSharedLibraryRegistry().register(new MyLibrary());
 * ```
 */
export type {
  BookSummary,
  BookTextPage,
  BookTextRequest,
  CatalogPage,
  FetchBookTextPageOptions,
  LibraryId,
  LibraryMeta,
  ListBooksOptions,
} from "./library";

export {
  ApiLibrary,
  bookRefKey,
  createDefaultRegistry,
  FALLBACK_CATALOG,
  getSharedLibraryRegistry,
  GutenbergLibrary,
  GUTENBERG_LIBRARY_ID,
  GUTENBERG_LIBRARY_LABEL,
  Library,
  LibraryRegistry,
} from "./library";

/** @deprecated Use {@link Library} */
export type { Library as BookSource } from "./library";

/** @deprecated Use {@link ApiLibrary} */
export { ApiLibrary as ApiBookSource } from "./library";

/** @deprecated Use {@link GutenbergLibrary} */
export { GutenbergLibrary as ProjectGutenbergBookSource } from "./library";
