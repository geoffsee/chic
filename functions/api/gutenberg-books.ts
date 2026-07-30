/**
 * Backward-compatible alias for Project Gutenberg catalog.
 * New clients should call `GET /api/books?library=gutenberg`.
 */
import { handleBooks } from "./books";
import { GUTENBERG_LIBRARY_ID } from "../../src/services/library";

type KVNamespace = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
};

type Env = {
  GUTENBERG_KV: KVNamespace;
};

export const handleGutenbergBooks = async (request: Request, env: Env) =>
  handleBooks(request, env, { defaultLibraryId: GUTENBERG_LIBRARY_ID });
