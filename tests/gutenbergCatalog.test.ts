import { describe, expect, test } from "bun:test";
import { handleGutenbergBooks } from "../functions/api/gutenberg-books";

type Store = Map<string, string>;

const createMemoryKv = (store: Store = new Map()) => ({
  async get(key: string) {
    return store.get(key) ?? null;
  },
  async put(key: string, value: string) {
    store.set(key, value);
  },
  store,
});

describe("handleGutenbergBooks pagination", () => {
  test("returns a lean CatalogPage shape from fallback when Gutendex is unreachable", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as typeof fetch;

    try {
      const env = { GUTENBERG_KV: createMemoryKv() };
      const response = await handleGutenbergBooks(
        new Request("https://example.com/api/gutenberg-books?page=1"),
        env,
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("X-Catalog-Source")).toBe("fallback");

      const body = (await response.json()) as {
        books: Array<Record<string, unknown>>;
        page: number;
        count: number;
        nextPage: number | null;
        search: string;
      };

      expect(body.page).toBe(1);
      expect(body.search).toBe("");
      expect(Array.isArray(body.books)).toBe(true);
      expect(body.books.length).toBeGreaterThan(0);
      expect(typeof body.count).toBe("number");
      // Lean payload: no Gutendex metadata blob on catalog entries.
      for (const book of body.books) {
        expect(book.metadata).toBeUndefined();
        expect(typeof book.id).toBe("string");
        expect(typeof book.title).toBe("string");
        expect(Array.isArray(book.authors)).toBe(true);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("filters fallback catalog by search and paginates", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as typeof fetch;

    try {
      const env = { GUTENBERG_KV: createMemoryKv() };
      const response = await handleGutenbergBooks(
        new Request("https://example.com/api/gutenberg-books?page=1&search=peter"),
        env,
      );
      const body = (await response.json()) as {
        books: Array<{ title: string }>;
        count: number;
        search: string;
        nextPage: number | null;
      };

      expect(body.search).toBe("peter");
      expect(body.count).toBeGreaterThan(0);
      expect(body.books.every((book) => book.title.toLowerCase().includes("peter"))).toBe(true);
      expect(body.nextPage).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("serves cached page on subsequent requests", async () => {
    const store = new Map<string, string>();
    const env = { GUTENBERG_KV: createMemoryKv(store) };
    const originalFetch = globalThis.fetch;
    let fetchCount = 0;

    globalThis.fetch = (async () => {
      fetchCount += 1;
      return new Response(
        JSON.stringify({
          count: 1,
          next: null,
          results: [
            {
              id: 11,
              title: "Alice's Adventures in Wonderland",
              authors: [{ name: "Carroll, Lewis" }],
              formats: {
                "text/plain; charset=utf-8": "https://www.gutenberg.org/ebooks/11.txt.utf-8",
              },
              bookshelves: ["Children's Literature"],
              subjects: ["Fantasy"],
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    try {
      const first = await handleGutenbergBooks(
        new Request("https://example.com/api/gutenberg-books?page=1&search=alice"),
        env,
      );
      const second = await handleGutenbergBooks(
        new Request("https://example.com/api/gutenberg-books?page=1&search=alice"),
        env,
      );

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(fetchCount).toBe(1);
      expect(store.size).toBe(1);

      const body = (await second.json()) as {
        books: Array<{ id: string; title: string; metadata?: unknown }>;
        nextPage: number | null;
      };
      expect(body.books[0]?.id).toBe("11");
      expect(body.books[0]?.title).toContain("Alice");
      expect(body.books[0]?.metadata).toBeUndefined();
      expect(body.nextPage).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
