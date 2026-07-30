/**
 * @deprecated Import from `./library` or `./bookService` instead.
 * Kept so existing relative imports keep type-checking during the transition.
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

export { bookRefKey, Library } from "./library";

/** @deprecated Use {@link Library} */
export type { Library as BookSource } from "./library";
