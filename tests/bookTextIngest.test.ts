import { describe, expect, test } from "bun:test";
import { bookTextCacheKey, downloadAndPrepareBookText } from "../src/services/bookTextIngest";
import {
  buildFallbackTextUrl,
  collectGutenbergTextCandidates,
  GutenbergLibrary,
} from "../src/services/library";

describe("bookTextIngest helpers", () => {
  test("bookTextCacheKey is versioned per library and book id", () => {
    expect(bookTextCacheKey("2701")).toContain("2701");
    expect(bookTextCacheKey("2701")).toContain("text:");
    expect(bookTextCacheKey("2701")).toContain("gutenberg");
    expect(bookTextCacheKey("2701", "archive")).toContain("archive");
  });

  test("buildFallbackTextUrl builds the stable PG cache path", () => {
    expect(buildFallbackTextUrl(11)).toBe("https://www.gutenberg.org/cache/epub/11/pg11.txt");
    expect(buildFallbackTextUrl("11")).toBe("https://www.gutenberg.org/cache/epub/11/pg11.txt");
    expect(buildFallbackTextUrl("nope")).toBeNull();
  });

  test("collectGutenbergTextCandidates prefers textUrl and always includes id fallback", () => {
    const urls = collectGutenbergTextCandidates({
      id: "11",
      textUrl: "http://www.gutenberg.org/ebooks/11.txt.utf-8",
    });
    expect(urls.some((u) => u.startsWith("https://") && u.includes("11.txt"))).toBe(true);
    expect(urls).toContain("https://www.gutenberg.org/cache/epub/11/pg11.txt");
  });

  test("downloadAndPrepareBookText prepares body via library pipeline", async () => {
    const raw = `*** START OF THE PROJECT GUTENBERG EBOOK DEMO ***

CHAPTER 1

Hello rabbit.

*** END OF THE PROJECT GUTENBERG EBOOK DEMO ***
`;
    const fetchImpl = (async () => new Response(raw, { status: 200 })) as typeof fetch;
    const library = new GutenbergLibrary();
    const result = await downloadAndPrepareBookText({ id: "1" }, library, fetchImpl);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toContain("Hello rabbit");
      expect(result.text).not.toContain("PROJECT GUTENBERG");
    }
  });

  test("downloadAndPrepareBookText surfaces download failures", async () => {
    const fetchImpl = (async () =>
      new Response("missing", { status: 503, statusText: "Unavailable" })) as typeof fetch;
    const library = new GutenbergLibrary();
    const result = await downloadAndPrepareBookText({ id: "1" }, library, fetchImpl);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(503);
    }
  });
});
