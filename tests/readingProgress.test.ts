import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  READING_PROGRESS_KEY,
  __resetReadingProgressMemoryForTests,
  clearReadingProgress,
  getBookPosition,
  loadReadingProgress,
  saveBookPosition,
} from "../src/services/readingProgress";

const memory = new Map<string, string>();

const installLocalStorageMock = () => {
  const storage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memory.set(key, String(value));
    },
    removeItem: (key: string) => {
      memory.delete(key);
    },
    clear: () => memory.clear(),
    key: (index: number) => [...memory.keys()][index] ?? null,
    get length() {
      return memory.size;
    },
  };
  // @ts-expect-error test shim
  globalThis.window = { localStorage: storage };
  // @ts-expect-error test shim
  globalThis.localStorage = storage;
};

describe("readingProgress (localStorage)", () => {
  beforeEach(() => {
    memory.clear();
    __resetReadingProgressMemoryForTests();
    installLocalStorageMock();
  });

  afterEach(() => {
    memory.clear();
    __resetReadingProgressMemoryForTests();
  });

  test("starts empty", () => {
    expect(loadReadingProgress()).toEqual({ positions: {} });
    expect(getBookPosition("pg-1")).toBeNull();
  });

  test("saves and reloads a book position", () => {
    const { store, persisted } = saveBookPosition("pg-11", {
      charIndex: 120,
      wordIndex: 40,
    });

    expect(persisted).toBe(true);
    expect(store.positions["pg-11"]).toMatchObject({
      charIndex: 120,
      wordIndex: 40,
    });
    expect(store.positions["pg-11"].updatedAt).toBeGreaterThan(0);

    __resetReadingProgressMemoryForTests();
    const reloaded = loadReadingProgress();
    expect(reloaded.positions["pg-11"]).toMatchObject({
      charIndex: 120,
      wordIndex: 40,
    });
    expect(getBookPosition("pg-11")?.wordIndex).toBe(40);
  });

  test("updates the same book without wiping others", () => {
    saveBookPosition("a", { charIndex: 1, wordIndex: 1 });
    saveBookPosition("b", { charIndex: 2, wordIndex: 2 });
    saveBookPosition("a", { charIndex: 99, wordIndex: 50 });

    const store = loadReadingProgress();
    expect(store.positions.a).toMatchObject({ charIndex: 99, wordIndex: 50 });
    expect(store.positions.b).toMatchObject({ charIndex: 2, wordIndex: 2 });
  });

  test("clamps negative indexes", () => {
    const { store } = saveBookPosition("pg-1", { charIndex: -5, wordIndex: -2 });
    expect(store.positions["pg-1"]).toMatchObject({ charIndex: 0, wordIndex: 0 });
  });

  test("ignores corrupt storage payloads", () => {
    memory.set(READING_PROGRESS_KEY, "{not-json");
    expect(loadReadingProgress()).toEqual({ positions: {} });

    memory.set(
      READING_PROGRESS_KEY,
      JSON.stringify({
        positions: {
          good: { charIndex: 3, wordIndex: 1, updatedAt: 1 },
          bad: { charIndex: "nope" },
        },
      }),
    );
    const store = loadReadingProgress();
    expect(store.positions.good).toMatchObject({ charIndex: 3, wordIndex: 1 });
    expect(store.positions.bad).toBeUndefined();
  });

  test("clear removes persisted data", () => {
    saveBookPosition("pg-1", { charIndex: 10, wordIndex: 4 });
    clearReadingProgress();
    expect(loadReadingProgress()).toEqual({ positions: {} });
    expect(memory.get(READING_PROGRESS_KEY)).toBeUndefined();
  });

  test("falls back to memory when localStorage throws on write", () => {
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    };
    // @ts-expect-error test shim
    globalThis.window = { localStorage: storage };

    const { persisted, store } = saveBookPosition("pg-9", {
      charIndex: 8,
      wordIndex: 2,
    });
    expect(persisted).toBe(false);
    // Still available in-process via memory fallback.
    expect(store.positions["pg-9"]).toMatchObject({ charIndex: 8, wordIndex: 2 });
  });
});
