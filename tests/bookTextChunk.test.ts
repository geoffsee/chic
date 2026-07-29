import { describe, expect, test } from "bun:test";
import {
  buildPageEnds,
  DEFAULT_BOOK_TEXT_PAGE_CHARS,
  findSoftBreak,
  getBookTextPage,
} from "../src/services/bookTextChunk";

describe("findSoftBreak", () => {
  test("returns end of text when target is past the end", () => {
    expect(findSoftBreak("hello", 10, 0)).toBe(5);
  });

  test("prefers a paragraph break near the target", () => {
    const text = "aaa\n\nbbb\n\nccc";
    // target after second paragraph marker
    const end = findSoftBreak(text, 8, 2);
    expect(text.slice(0, end)).toBe("aaa\n\n");
  });

  test("falls back to a space when no newlines exist", () => {
    const text = "one two three four five";
    const end = findSoftBreak(text, 12, 4);
    expect(text[end - 1]).toBe(" ");
  });
});

describe("buildPageEnds", () => {
  test("empty text yields a single empty page end", () => {
    expect(buildPageEnds("")).toEqual([0]);
  });

  test("short text fits in one page", () => {
    expect(buildPageEnds("hello world", 100)).toEqual([11]);
  });

  test("splits long text into multiple pages without overlapping", () => {
    const para = "word ".repeat(50).trim() + "\n\n";
    const full = para.repeat(10);
    const ends = buildPageEnds(full, 80);
    expect(ends.length).toBeGreaterThan(1);
    expect(ends[ends.length - 1]).toBe(full.length);

    let prev = 0;
    for (const end of ends) {
      expect(end).toBeGreaterThan(prev);
      prev = end;
    }
  });

  test("rejects invalid page size", () => {
    expect(() => buildPageEnds("abc", 0)).toThrow();
  });
});

describe("getBookTextPage", () => {
  const full = [
    "CHAPTER 1\n\n",
    "alpha ".repeat(200),
    "\n\nCHAPTER 2\n\n",
    "beta ".repeat(200),
  ].join("");

  test("page 1 returns a prefix and points at page 2 when more remains", () => {
    const page = getBookTextPage(full, "42", 1, 200);
    expect(page.id).toBe("42");
    expect(page.page).toBe(1);
    expect(page.start).toBe(0);
    expect(page.end).toBe(page.text.length);
    expect(page.text).toBe(full.slice(0, page.end));
    expect(page.totalChars).toBe(full.length);
    expect(page.totalPages).toBeGreaterThan(1);
    expect(page.nextPage).toBe(2);
  });

  test("pages concatenate back to the full prepared text", () => {
    const pageChars = 180;
    const first = getBookTextPage(full, "1", 1, pageChars);
    let assembled = first.text;
    let next = first.nextPage;
    while (next != null) {
      const page = getBookTextPage(full, "1", next, pageChars);
      assembled += page.text;
      next = page.nextPage;
    }
    expect(assembled).toBe(full);
  });

  test("clamps out-of-range page numbers", () => {
    const page = getBookTextPage("short", "9", 99, DEFAULT_BOOK_TEXT_PAGE_CHARS);
    expect(page.page).toBe(1);
    expect(page.nextPage).toBeNull();
    expect(page.text).toBe("short");
  });

  test("page 0 is treated as page 1", () => {
    const page = getBookTextPage("abc", "1", 0, 10);
    expect(page.page).toBe(1);
    expect(page.text).toBe("abc");
  });
});
