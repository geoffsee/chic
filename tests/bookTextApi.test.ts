import { describe, expect, test } from "bun:test";
import { handleBookText } from "../functions/api/book-text";
import { bookTextCacheKey } from "../src/services/bookTextIngest";
import { createMemoryKv } from "../src/services/memoryKv";

const SAMPLE_BOOK = `*** START OF THE PROJECT GUTENBERG EBOOK DEMO ***

CHAPTER 1

${"Once upon a time there was a rabbit who lived in a green wood. ".repeat(200)}

CHAPTER 2

${"Then the rabbit went home and told a long story to his friends. ".repeat(200)}

*** END OF THE PROJECT GUTENBERG EBOOK DEMO ***
`;

describe("handleBookText chunked API", () => {
  test("ingests into KV and returns only the first page", async () => {
    const kv = createMemoryKv();
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("gutenberg.org") || url.includes(".txt")) {
        return new Response(SAMPLE_BOOK, { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    try {
      const response = await handleBookText(
        new Request("https://example.com/api/book-text", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: "999", page: 1 }),
        }),
        { GUTENBERG_KV: kv },
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("X-Book-Text-Source")).toBe("ingest");
      expect(response.headers.get("Content-Type")).toContain("application/json");

      const body = (await response.json()) as {
        id: string;
        page: number;
        text: string;
        nextPage: number | null;
        totalPages: number;
        totalChars: number;
      };

      expect(body.id).toBe("999");
      expect(body.page).toBe(1);
      expect(body.text.length).toBeGreaterThan(0);
      expect(body.text.length).toBeLessThan(body.totalChars);
      expect(body.totalPages).toBeGreaterThan(1);
      expect(body.nextPage).toBe(2);
      // Client must not receive the whole PG wrapper / full dump.
      expect(body.text).not.toContain("PROJECT GUTENBERG EBOOK");
      expect(body.text.length).toBeLessThan(SAMPLE_BOOK.length);

      const cached = await kv.get(bookTextCacheKey("999"));
      expect(cached).toBeTruthy();
      expect(cached!.length).toBe(body.totalChars);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("serves later pages from KV without re-downloading", async () => {
    const full =
      "CHAPTER 1\n\n" + "alpha ".repeat(1500) + "\n\nCHAPTER 2\n\n" + "beta ".repeat(1500);

    const kv = createMemoryKv(new Map([[bookTextCacheKey("7"), full]]));
    let fetchCount = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      fetchCount += 1;
      return new Response("should not be used", { status: 200 });
    }) as typeof fetch;

    try {
      const response = await handleBookText(
        new Request("https://example.com/api/book-text", {
          method: "POST",
          body: JSON.stringify({ id: "7", page: 2 }),
        }),
        { GUTENBERG_KV: kv },
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("X-Book-Text-Source")).toBe("kv");
      expect(fetchCount).toBe(0);

      const body = (await response.json()) as {
        page: number;
        text: string;
        start: number;
        end: number;
      };
      expect(body.page).toBe(2);
      expect(body.start).toBeGreaterThan(0);
      expect(full.slice(body.start, body.end)).toBe(body.text);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("rejects missing book id", async () => {
    const response = await handleBookText(
      new Request("https://example.com/api/book-text", {
        method: "POST",
        body: JSON.stringify({ page: 1 }),
      }),
      { GUTENBERG_KV: createMemoryKv() },
    );
    expect(response.status).toBe(400);
  });

  test("returns download error status when Gutenberg fails", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("nope", { status: 404, statusText: "Not Found" })) as typeof fetch;

    try {
      const response = await handleBookText(
        new Request("https://example.com/api/book-text", {
          method: "POST",
          body: JSON.stringify({ id: "404", page: 1 }),
        }),
        { GUTENBERG_KV: createMemoryKv() },
      );
      expect(response.status).toBe(404);
      const body = (await response.json()) as { error: string };
      expect(body.error).toContain("Failed to download");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
