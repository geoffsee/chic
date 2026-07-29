/**
 * Client-only reading progress.
 * No accounts / server sync yet — localStorage is enough and avoids cookies.
 */

export type ReadingPosition = {
  charIndex: number;
  wordIndex: number;
  updatedAt: number;
};

export type ReadingProgressStore = {
  positions: Record<string, ReadingPosition>;
};

/**
 * Bump the version suffix if the shape changes incompatibly
 * (e.g. book text preparation shifts character offsets).
 */
export const READING_PROGRESS_KEY = "chic.readingProgress.v2";

const emptyStore = (): ReadingProgressStore => ({ positions: {} });

/** In-memory fallback when localStorage is missing or blocked. */
let memoryStore: ReadingProgressStore = emptyStore();

const canUseLocalStorage = (): boolean => {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return false;
    }
    const probe = "__chic_progress_probe__";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
};

const readRaw = (): string | null => {
  if (!canUseLocalStorage()) {
    return null;
  }
  try {
    return window.localStorage.getItem(READING_PROGRESS_KEY);
  } catch {
    return null;
  }
};

const writeRaw = (value: string): boolean => {
  if (!canUseLocalStorage()) {
    return false;
  }
  try {
    window.localStorage.setItem(READING_PROGRESS_KEY, value);
    return true;
  } catch {
    // Quota exceeded or blocked — keep memory copy only.
    return false;
  }
};

const isPosition = (value: unknown): value is ReadingPosition => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.charIndex === "number" &&
    Number.isFinite(record.charIndex) &&
    typeof record.wordIndex === "number" &&
    Number.isFinite(record.wordIndex)
  );
};

const normalizeStore = (value: unknown): ReadingProgressStore => {
  if (!value || typeof value !== "object") {
    return emptyStore();
  }
  const rawPositions = (value as { positions?: unknown }).positions;
  if (!rawPositions || typeof rawPositions !== "object") {
    return emptyStore();
  }

  const positions: Record<string, ReadingPosition> = {};
  for (const [bookId, entry] of Object.entries(rawPositions as Record<string, unknown>)) {
    if (!bookId || !isPosition(entry)) {
      continue;
    }
    positions[bookId] = {
      charIndex: Math.max(0, Math.floor(entry.charIndex)),
      wordIndex: Math.max(0, Math.floor(entry.wordIndex)),
      updatedAt:
        typeof (entry as ReadingPosition).updatedAt === "number"
          ? (entry as ReadingPosition).updatedAt
          : Date.now(),
    };
  }
  return { positions };
};

/** Load all saved positions (sync). Safe to call on every mount. */
export const loadReadingProgress = (): ReadingProgressStore => {
  const raw = readRaw();
  if (!raw) {
    return { positions: { ...memoryStore.positions } };
  }
  try {
    const parsed = normalizeStore(JSON.parse(raw));
    memoryStore = parsed;
    return { positions: { ...parsed.positions } };
  } catch {
    return emptyStore();
  }
};

export const getBookPosition = (bookId: string): ReadingPosition | null => {
  if (!bookId) {
    return null;
  }
  const store = loadReadingProgress();
  return store.positions[bookId] ?? null;
};

/**
 * Persist one book's place. Returns the full store after write
 * (and whether localStorage accepted the write).
 */
export const saveBookPosition = (
  bookId: string,
  position: { charIndex: number; wordIndex: number },
): { store: ReadingProgressStore; persisted: boolean } => {
  if (!bookId) {
    return { store: loadReadingProgress(), persisted: false };
  }

  const store = loadReadingProgress();
  store.positions[bookId] = {
    charIndex: Math.max(0, Math.floor(position.charIndex)),
    wordIndex: Math.max(0, Math.floor(position.wordIndex)),
    updatedAt: Date.now(),
  };
  memoryStore = store;
  const persisted = writeRaw(JSON.stringify(store));
  return { store: { positions: { ...store.positions } }, persisted };
};

export const clearReadingProgress = (): void => {
  memoryStore = emptyStore();
  if (!canUseLocalStorage()) {
    return;
  }
  try {
    window.localStorage.removeItem(READING_PROGRESS_KEY);
  } catch {
    // ignore
  }
};

/** Test helper: reset memory fallback without touching real storage. */
export const __resetReadingProgressMemoryForTests = (): void => {
  memoryStore = emptyStore();
};
