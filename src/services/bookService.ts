/**
 * Public surface for book catalog + text sources.
 * Implementations live in dedicated modules to keep this file thin.
 */
export type {
  BookSource,
  BookSummary,
  BookTextPage,
  CatalogPage,
  FetchBookTextPageOptions,
  ListBooksOptions,
} from "./bookTypes";

export { ApiBookSource } from "./apiBookSource";
export { ProjectGutenbergBookSource } from "./projectGutenbergBookSource";
