import { describe, expect, test } from "bun:test";
import {
  bookRefKey,
  GutenbergLibrary,
  Library,
  LibraryRegistry,
  type BookSummary,
  type BookTextPage,
  type CatalogPage,
  type ListBooksOptions,
} from "../src/services/library";
import { handleBooks, handleLibraries } from "../functions/api/books";
import { createMemoryKv } from "../src/services/memoryKv";

/** Minimal second source used only to prove the plugin contract. */
class DemoLibrary extends Library {
  readonly id = "demo";
  readonly label = "Demo Library";

  async listBooks(options?: ListBooksOptions): Promise<CatalogPage> {
    const search = (options?.search ?? "").trim().toLowerCase();
    const books: BookSummary[] = [
      {
        id: "alpha",
        libraryId: this.id,
        title: "Alpha Adventure",
        authors: ["Demo Author"],
        sourceLabel: this.label,
        textUrl: "https://example.com/alpha.txt",
      },
      {
        id: "beta",
        libraryId: this.id,
        title: "Beta Book",
        authors: ["Demo Author"],
        sourceLabel: this.label,
      },
    ].filter((book) => !search || book.title.toLowerCase().includes(search));

    return {
      books,
      page: 1,
      count: books.length,
      nextPage: null,
      search: options?.search ?? "",
      libraryId: this.id,
    };
  }

  async fetchBookTextPage(book: BookSummary): Promise<BookTextPage> {
    const text = `Hello from ${book.title}`;
    return {
      id: book.id,
      libraryId: this.id,
      page: 1,
      text,
      nextPage: null,
      totalPages: 1,
      totalChars: text.length,
      start: 0,
      end: text.length,
    };
  }

  resolveTextCandidates(book: { textUrl?: string }) {
    return book.textUrl ? [book.textUrl] : [];
  }

  prepareText(raw: string) {
    return raw.trim();
  }
}

describe("Library plugin system", () => {
  test("bookRefKey namespaces ids per library", () => {
    expect(bookRefKey({ libraryId: "gutenberg", id: "11" })).toBe("gutenberg:11");
    expect(bookRefKey({ libraryId: "demo", id: "11" })).toBe("demo:11");
  });

  test("registry registers and resolves libraries", () => {
    const registry = new LibraryRegistry();
    registry.register(new GutenbergLibrary(), { default: true });
    registry.register(new DemoLibrary());

    expect(registry.listMeta()).toEqual([
      { id: "gutenberg", label: "Project Gutenberg" },
      { id: "demo", label: "Demo Library" },
    ]);
    expect(registry.require().id).toBe("gutenberg");
    expect(registry.require("demo").id).toBe("demo");
    expect(() => registry.require("missing")).toThrow(/Unknown library/);
  });

  test("handleLibraries lists registered plugins", async () => {
    const registry = new LibraryRegistry();
    registry.register(new DemoLibrary(), { default: true });
    const response = await handleLibraries(new Request("https://example.com/api/libraries"), {
      registry,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { libraries: Array<{ id: string }> };
    expect(body.libraries).toEqual([{ id: "demo", label: "Demo Library" }]);
  });

  test("handleBooks dispatches to a non-Gutenberg library", async () => {
    const registry = new LibraryRegistry();
    registry.register(new DemoLibrary(), { default: true });

    const response = await handleBooks(
      new Request("https://example.com/api/books?library=demo&search=alpha"),
      { GUTENBERG_KV: createMemoryKv() },
      { registry },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Library-Id")).toBe("demo");

    const body = (await response.json()) as CatalogPage;
    expect(body.libraryId).toBe("demo");
    expect(body.books).toHaveLength(1);
    expect(body.books[0]?.title).toBe("Alpha Adventure");
    expect(body.books[0]?.libraryId).toBe("demo");
  });

  test("GutenbergLibrary stamps libraryId on summaries", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("offline");
    }) as typeof fetch;

    try {
      const library = new GutenbergLibrary();
      const page = await library.listBooks({ page: 1 });
      expect(page.libraryId).toBe("gutenberg");
      expect(page.books.every((b) => b.libraryId === "gutenberg")).toBe(true);
      expect(library.textCacheKey("11")).toBe("text:v4:gutenberg:11");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
