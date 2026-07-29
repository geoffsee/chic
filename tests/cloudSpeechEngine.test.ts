import { describe, expect, test, mock, beforeAll } from "bun:test";
import { CloudSpeechEngine } from "../src/speech/engines/cloudSpeechEngine";
import { nextSpeechChunk } from "../src/speech/chunking";

const makeBlob = (label: string) => new Blob([label], { type: "audio/mpeg" });

/** Multi-sentence book long enough to span several maxChunkChars windows. */
const longBook = Array.from({ length: 40 }, (_, i) => {
  return `Chapter sentence number ${i + 1} continues the story with enough words to fill the buffer.`;
}).join(" ");

beforeAll(() => {
  // Bun unit tests have no DOM rAF; the engine uses it only for highlight ticks.
  if (typeof globalThis.requestAnimationFrame !== "function") {
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
      setTimeout(() => cb(Date.now()), 0) as unknown as number) as typeof requestAnimationFrame;
  }
  if (typeof globalThis.cancelAnimationFrame !== "function") {
    globalThis.cancelAnimationFrame = ((id: number) =>
      clearTimeout(id)) as typeof cancelAnimationFrame;
  }
});

describe("CloudSpeechEngine prefetch", () => {
  test("prefetchNext warms multiple upcoming segments", async () => {
    const texts: string[] = [];
    const synthesize = mock(async (text: string) => {
      texts.push(text);
      await new Promise((r) => setTimeout(r, 5));
      return makeBlob(text);
    });

    const engine = new CloudSpeechEngine({
      synthesize: synthesize as never,
      getSpeaker: () => "luna",
      prefetchDepth: 2,
      createAudio: () => createMockAudio(),
    });

    expect(longBook.length).toBeGreaterThan(engine.maxChunkChars * 2);

    engine.prefetchNext(longBook, 0);
    await waitFor(() => engine.getPrefetchQueueSize() >= 2, 500);

    expect(engine.getPrefetchQueueSize()).toBe(2);
    expect(synthesize.mock.calls.length).toBe(2);

    const c0 = nextSpeechChunk(longBook, 0, engine.maxChunkChars)!;
    const c1 = nextSpeechChunk(longBook, c0.end, engine.maxChunkChars)!;
    expect(texts).toContain(c0.text);
    expect(texts).toContain(c1.text);

    engine.dispose();
  });

  test("speak uses prefetched blob without re-synthesizing that segment", async () => {
    const synthesized: string[] = [];
    const synthesize = mock(async (text: string) => {
      synthesized.push(text);
      await new Promise((r) => setTimeout(r, 5));
      return makeBlob(text);
    });

    const engine = new CloudSpeechEngine({
      synthesize: synthesize as never,
      getSpeaker: () => "luna",
      prefetchDepth: 2,
      createAudio: () => createMockAudio({ autoEndMs: 20 }),
    });

    const first = nextSpeechChunk(longBook, 0, engine.maxChunkChars)!;

    // Prefetch starting at 0 so the first chunk is warm.
    engine.prefetchNext(longBook, 0);
    await waitFor(() => engine.getPrefetchQueueSize() >= 1, 500);
    expect(synthesized.filter((t) => t === first.text).length).toBe(1);

    await engine.speak(
      first,
      {
        isCurrent: () => true,
        onHighlight: () => {},
      },
      new AbortController().signal,
    );

    // Current segment must not be synthesized a second time (cache hit).
    // Further lookahead may still synthesize successors — that's fine.
    expect(synthesized.filter((t) => t === first.text).length).toBe(1);
    engine.dispose();
  });

  test("cancel aborts the prefetch queue", async () => {
    let started = 0;
    let aborted = 0;
    const synthesize = mock(async (_text: string, _speaker: string, signal?: AbortSignal) => {
      started += 1;
      return new Promise<Blob>((resolve, reject) => {
        const onAbort = () => {
          aborted += 1;
          reject(new DOMException("Aborted", "AbortError"));
        };
        if (signal?.aborted) {
          onAbort();
          return;
        }
        signal?.addEventListener("abort", onAbort, { once: true });
        setTimeout(() => resolve(makeBlob("x")), 200);
      });
    });

    const engine = new CloudSpeechEngine({
      synthesize: synthesize as never,
      getSpeaker: () => "luna",
      prefetchDepth: 2,
      createAudio: () => createMockAudio(),
    });

    const book =
      "One longish sentence for segment A is written. Two longish sentence for segment B is written. Three for C.";
    engine.prefetchNext(book, 0);
    await waitFor(() => started >= 1, 200);
    engine.cancel();
    await waitFor(() => aborted >= 1, 200);
    expect(engine.getPrefetchQueueSize()).toBe(0);
    engine.dispose();
  });
});

function createMockAudio(options?: { autoEndMs?: number }): HTMLAudioElement {
  const autoEndMs = options?.autoEndMs ?? 0;
  let ended = false;
  let paused = true;
  let currentTime = 0;
  const duration = 1;

  const audio = {
    src: "",
    paused: true,
    ended: false,
    currentTime: 0,
    duration,
    onended: null as null | (() => void),
    onerror: null as null | (() => void),
    onloadedmetadata: null as null | (() => void),
    ontimeupdate: null as null | (() => void),
    onplaying: null as null | (() => void),
    onpause: null as null | (() => void),
    pause() {
      paused = true;
      (audio as { paused: boolean }).paused = true;
      audio.onpause?.();
    },
    play() {
      paused = false;
      ended = false;
      (audio as { paused: boolean }).paused = false;
      (audio as { ended: boolean }).ended = false;
      audio.onplaying?.();
      if (autoEndMs > 0) {
        setTimeout(() => {
          currentTime = duration;
          (audio as { currentTime: number }).currentTime = duration;
          ended = true;
          paused = true;
          (audio as { ended: boolean }).ended = true;
          (audio as { paused: boolean }).paused = true;
          audio.onended?.();
        }, autoEndMs);
      }
      return Promise.resolve();
    },
    load() {},
    removeAttribute() {
      audio.src = "";
    },
  };

  // Keep props writable for engine.
  Object.defineProperties(audio, {
    currentTime: {
      get: () => currentTime,
      set: (v: number) => {
        currentTime = v;
      },
    },
    duration: { get: () => duration },
  });

  return audio as unknown as HTMLAudioElement;
}

const waitFor = async (predicate: () => boolean, timeoutMs = 1000) => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitFor timeout");
    }
    await new Promise((r) => setTimeout(r, 10));
  }
};
