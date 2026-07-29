import { describe, expect, test } from "bun:test";
import {
  bookTextCacheKey,
  buildFallbackTextUrl,
  collectTextCandidates,
  downloadAndPrepareBookText,
} from "../src/services/bookTextIngest";

describe("bookTextIngest helpers", () => {
  test("bookTextCacheKey is versioned per book id", () => {
    expect(bookTextCacheKey("2701")).toContain("2701");
    expect(bookTextCacheKey("2701")).toContain("text:");
  });

  test("buildFallbackTextUrl builds the stable PG cache path", () => {
    expect(buildFallbackTextUrl(11)).toBe("https://www.gutenberg.org/cache/epub/11/pg11.txt");
    expect(buildFallbackTextUrl("11")).toBe("https://www.gutenberg.org/cache/epub/11/pg11.txt");
    expect(buildFallbackTextUrl("nope")).toBeNull();
  });

  test("collectTextCandidates prefers textUrl and always includes id fallback", () => {
    const urls = collectTextCandidates({
      id: "11",
      textUrl: "http://www.gutenberg.org/ebooks/11.txt.utf-8",
    });
    expect(urls.some((u) => u.startsWith("https://") && u.includes("11.txt"))).toBe(true);
    expect(urls).toContain("https://www.gutenberg.org/cache/epub/11/pg11.txt");
  });

  test("downloadAndPrepareBookText prepares body and strips wrappers", async () => {
    const raw = `*** START OF THE PROJECT GUTENBERG EBOOK DEMO ***

CHAPTER 1

Hello rabbit.

*** END OF THE PROJECT GUTENBERG EBOOK DEMO ***
`;
    const fetchImpl = (async () => new Response(raw, { status: 200 })) as typeof fetch;
    const result = await downloadAndPrepareBookText({ id: "1" }, fetchImpl);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toContain("Hello rabbit");
      expect(result.text).not.toContain("PROJECT GUTENBERG");
    }
  });

  test("downloadAndPrepareBookText surfaces download failures", async () => {
    const fetchImpl = (async () =>
      new Response("missing", { status: 503, statusText: "Unavailable" })) as typeof fetch;
    const result = await downloadAndPrepareBookText({ id: "1" }, fetchImpl);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(503);
    }
  });
});
