import { describe, expect, test, mock } from "bun:test";
import { ReadingPlayer } from "../src/speech/ReadingPlayer";
import type { PlayerSnapshot, SpeakHandlers, SpeechEngine } from "../src/speech/types";
import type { SpeechChunk } from "../src/speech/chunking";
import { COPY } from "../src/speech/copy";

class MockEngine implements SpeechEngine {
  readonly id: "cloud" | "browser";
  readonly maxChunkChars: number;
  speakCalls: SpeechChunk[] = [];
  prefetchCalls: number[] = [];
  failNext = false;
  failAlways = false;
  paused = false;
  cancelled = 0;
  private resolveSpeak: (() => void) | null = null;

  constructor(id: "cloud" | "browser", maxChunkChars = 50) {
    this.id = id;
    this.maxChunkChars = maxChunkChars;
  }

  async probe() {
    return true;
  }

  speak(chunk: SpeechChunk, handlers: SpeakHandlers, signal: AbortSignal): Promise<void> {
    this.speakCalls.push(chunk);
    handlers.onHighlight(chunk.start, "start");

    if (this.failAlways || this.failNext) {
      this.failNext = false;
      return Promise.reject(new Error(`${this.id} failed`));
    }

    return new Promise((resolve) => {
      if (signal.aborted || !handlers.isCurrent()) {
        resolve();
        return;
      }

      const onAbort = () => {
        signal.removeEventListener("abort", onAbort);
        this.resolveSpeak = null;
        resolve();
      };
      signal.addEventListener("abort", onAbort, { once: true });

      this.resolveSpeak = () => {
        signal.removeEventListener("abort", onAbort);
        this.resolveSpeak = null;
        if (!handlers.isCurrent()) {
          resolve();
          return;
        }
        handlers.onHighlight(chunk.end - 1, "boundary");
        resolve();
      };

      queueMicrotask(() => {
        if (this.resolveSpeak) {
          this.resolveSpeak();
        }
      });
    });
  }

  prefetchNext(_bookText: string, fromChar: number) {
    this.prefetchCalls.push(fromChar);
  }

  pause() {
    this.paused = true;
  }

  resume() {
    this.paused = false;
  }

  cancel() {
    this.cancelled += 1;
    this.resolveSpeak?.();
  }

  dispose() {
    this.cancel();
  }
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

describe("ReadingPlayer", () => {
  test("prefers cloud when available and walks chunks until end", async () => {
    const cloud = new MockEngine("cloud", 40);
    const browser = new MockEngine("browser", 40);
    const highlights: number[] = [];

    const player = new ReadingPlayer({
      engines: [cloud, browser],
      listeners: {
        onSnapshot: () => {},
        onHighlight: (charIndex) => highlights.push(charIndex),
      },
      fetchStatus: async () => ({
        available: true,
        defaultSpeaker: "luna",
        engine: "workers-ai",
      }),
    });

    const text =
      "Alpha sentence one is here. Beta sentence two is next. Gamma sentence three ends.";
    player.setText(text);
    await player.prepare();
    expect(player.getSnapshot().ready).toBe(true);
    expect(player.getSnapshot().cloudAvailable).toBe(true);
    expect(player.getSnapshot().engine).toBe("cloud");
    expect(player.getSnapshot().statusMessage).not.toContain("CLOUDFLARE");

    player.start(0);
    await waitFor(() => player.getSnapshot().phase === "idle");

    expect(cloud.speakCalls.length).toBeGreaterThan(1);
    expect(browser.speakCalls.length).toBe(0);
    expect(highlights[0]).toBe(0);
    expect(cloud.speakCalls.at(-1)!.end).toBeGreaterThan(text.length / 2);
    // Prefetch must run for each chunk (before speak), not only after the last one.
    expect(cloud.prefetchCalls.length).toBeGreaterThanOrEqual(cloud.speakCalls.length);
    // First prefetch targets the end of the first chunk (load *next* while speaking current).
    expect(cloud.prefetchCalls[0]).toBe(cloud.speakCalls[0].end);
  });

  test("does not silently fall back — asks the user instead", async () => {
    const cloud = new MockEngine("cloud", 200);
    cloud.failAlways = true;
    const browser = new MockEngine("browser", 200);

    const player = new ReadingPlayer({
      engines: [cloud, browser],
      autoFallback: false,
      listeners: {
        onSnapshot: () => {},
        onHighlight: () => {},
      },
      fetchStatus: async () => ({ available: true, engine: "workers-ai" }),
    });

    player.setText("Hello world from the novel.");
    await player.prepare();
    player.start(0);
    await waitFor(() => player.getSnapshot().phase === "error");

    const snap = player.getSnapshot();
    expect(browser.speakCalls.length).toBe(0);
    expect(snap.notice?.kind).toBe("error");
    expect(snap.notice?.message).toBe(COPY.cloudFailed);
    expect(snap.notice?.actions).toContain("use-device-voice");
    expect(snap.notice?.actions).toContain("retry");
  });

  test("useDeviceVoiceAndContinue is an explicit user choice", async () => {
    const cloud = new MockEngine("cloud", 200);
    cloud.failAlways = true;
    const browser = new MockEngine("browser", 200);

    const player = new ReadingPlayer({
      engines: [cloud, browser],
      listeners: {
        onSnapshot: () => {},
        onHighlight: () => {},
      },
      fetchStatus: async () => ({ available: true }),
    });

    player.setText("Hello world from the novel.");
    await player.prepare();
    player.start(0);
    await waitFor(() => player.getSnapshot().phase === "error");

    // Cloud will still fail if chosen; force device path.
    cloud.failAlways = true;
    player.useDeviceVoiceAndContinue();
    await waitFor(() => player.getSnapshot().phase === "idle");

    expect(browser.speakCalls.length).toBeGreaterThanOrEqual(1);
    expect(player.getSnapshot().engine).toBe("browser");
  });

  test("autoFallback can still switch when opted in", async () => {
    const cloud = new MockEngine("cloud", 200);
    cloud.failAlways = true;
    const browser = new MockEngine("browser", 200);

    const player = new ReadingPlayer({
      engines: [cloud, browser],
      autoFallback: true,
      listeners: {
        onSnapshot: () => {},
        onHighlight: () => {},
      },
      fetchStatus: async () => ({ available: true }),
    });

    player.setText("Hello world from the novel.");
    await player.prepare();
    player.start(0);
    await waitFor(() => player.getSnapshot().phase === "idle");

    expect(browser.speakCalls.length).toBeGreaterThanOrEqual(1);
    expect(player.getSnapshot().engine).toBe("browser");
    expect(player.getSnapshot().statusMessage).toMatch(/device voice/i);
  });

  test("stop invalidates in-flight generation and cancels engines", async () => {
    const cloud = new MockEngine("cloud", 20);
    cloud.speak = (chunk, handlers, signal) =>
      new Promise((resolve) => {
        cloud.speakCalls.push(chunk);
        const onAbort = () => {
          signal.removeEventListener("abort", onAbort);
          resolve();
        };
        signal.addEventListener("abort", onAbort, { once: true });
      });

    const browser = new MockEngine("browser", 20);
    const player = new ReadingPlayer({
      engines: [cloud, browser],
      listeners: {
        onSnapshot: () => {},
        onHighlight: () => {},
      },
      fetchStatus: async () => ({ available: true }),
    });

    player.setText("One two three four five six seven eight nine ten.");
    await player.prepare();
    player.start(0);
    await waitFor(() => cloud.speakCalls.length >= 1);
    player.stop();

    expect(cloud.cancelled).toBeGreaterThanOrEqual(1);
    expect(player.getSnapshot().phase).toBe("idle");
    expect(player.getSnapshot().speaking).toBe(false);
    expect(player.getSnapshot().notice).toBeNull();
  });

  test("uses browser only when cloud is unavailable", async () => {
    const cloud = new MockEngine("cloud", 100);
    const browser = new MockEngine("browser", 100);
    const player = new ReadingPlayer({
      engines: [cloud, browser],
      listeners: {
        onSnapshot: () => {},
        onHighlight: () => {},
      },
      fetchStatus: async () => ({ available: false, engine: "none" }),
    });

    player.setText("Only the browser will speak this line.");
    await player.prepare();
    expect(player.getSnapshot().engine).toBe("browser");
    expect(player.getSnapshot().statusMessage).toMatch(/device/i);
    player.start(0);
    await waitFor(() => player.getSnapshot().phase === "idle");

    expect(cloud.speakCalls.length).toBe(0);
    expect(browser.speakCalls.length).toBeGreaterThanOrEqual(1);
  });

  test("prepare surfaces not-ready when no engines can run", async () => {
    const player = new ReadingPlayer({
      engines: [],
      listeners: {
        onSnapshot: () => {},
        onHighlight: () => {},
      },
      fetchStatus: async () => ({ available: false }),
    });

    await player.prepare();
    expect(player.getSnapshot().ready).toBe(false);
    expect(player.getSnapshot().statusMessage).toBe(COPY.noneReady);
    player.start(0);
    expect(player.getSnapshot().phase).toBe("idle");
  });

  test("preferEngine locks the voice type until the user changes it", async () => {
    const cloud = new MockEngine("cloud", 100);
    const browser = new MockEngine("browser", 100);
    const player = new ReadingPlayer({
      engines: [cloud, browser],
      listeners: {
        onSnapshot: () => {},
        onHighlight: () => {},
      },
      fetchStatus: async () => ({ available: true }),
    });

    await player.prepare();
    expect(player.getSnapshot().engine).toBe("cloud");
    player.preferEngine("browser");
    expect(player.getSnapshot().engine).toBe("browser");

    player.setText("Device only for this run.");
    player.start(0);
    await waitFor(() => player.getSnapshot().phase === "idle");
    expect(cloud.speakCalls.length).toBe(0);
    expect(browser.speakCalls.length).toBeGreaterThanOrEqual(1);
  });

  test("shows buffering before audio so silence is explained", async () => {
    const phases: string[] = [];
    let release: (() => void) | null = null;
    const cloud: SpeechEngine = {
      id: "cloud",
      maxChunkChars: 500,
      probe: async () => true,
      speak: (chunk, handlers, signal) =>
        new Promise((resolve) => {
          const onAbort = () => {
            signal.removeEventListener("abort", onAbort);
            resolve();
          };
          signal.addEventListener("abort", onAbort, { once: true });
          release = () => {
            handlers.onHighlight(chunk.start, "start");
            signal.removeEventListener("abort", onAbort);
            resolve();
          };
        }),
      pause: () => {},
      resume: () => {},
      cancel: () => {
        release?.();
      },
      dispose: () => {},
    };

    const player = new ReadingPlayer({
      engines: [cloud],
      listeners: {
        onSnapshot: (s: PlayerSnapshot) => phases.push(s.phase),
        onHighlight: () => {},
      },
      fetchStatus: async () => ({ available: true }),
    });

    player.setText("A short passage.");
    await player.prepare();
    player.start(0);
    await waitFor(() => phases.includes("buffering"));
    expect(player.getSnapshot().detailMessage).toBe(COPY.buffering);
    release?.();
    player.stop();
  });

  test("pause and resume toggle snapshot without advancing incorrectly", async () => {
    let release: (() => void) | null = null;
    const cloud: SpeechEngine = {
      id: "cloud",
      maxChunkChars: 500,
      probe: async () => true,
      speak: (chunk, handlers, signal) =>
        new Promise((resolve) => {
          handlers.onHighlight(chunk.start, "start");
          const onAbort = () => {
            signal.removeEventListener("abort", onAbort);
            resolve();
          };
          signal.addEventListener("abort", onAbort, { once: true });
          release = () => {
            signal.removeEventListener("abort", onAbort);
            resolve();
          };
        }),
      pause: mock(() => {}),
      resume: mock(() => {}),
      cancel: () => {
        release?.();
      },
      dispose: () => {},
    };

    const player = new ReadingPlayer({
      engines: [cloud],
      listeners: {
        onSnapshot: () => {},
        onHighlight: () => {},
      },
      fetchStatus: async () => ({ available: true }),
    });

    player.setText("A long enough passage for pause testing here.");
    await player.prepare();
    player.start(0);
    await waitFor(
      () =>
        player.getSnapshot().phase === "speaking" ||
        player.getSnapshot().phase === "loading" ||
        player.getSnapshot().phase === "buffering",
    );
    player.pause();
    expect(player.getSnapshot().paused).toBe(true);
    expect(player.getSnapshot().phase).toBe("paused");
    player.resume();
    expect(player.getSnapshot().paused).toBe(false);
    release?.();
    player.stop();
  });
});
