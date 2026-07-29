import { CLOUD_SPEECH_CHUNK, nextSpeechChunk, type SpeechChunk } from "../chunking";
import {
  audioProgress,
  wordIndexForProgress,
  wordsInChunkText,
  type LocalWord,
} from "../audioHighlight";
import { synthesizeCloudSpeech } from "../../services/cloudTts";
import type { SpeakHandlers, SpeechEngine } from "../types";

/** Prefer a small lead so the highlight is on the word being spoken, not behind. */
const HIGHLIGHT_LEAD = 0.02;

type PrefetchEntry = {
  start: number;
  end: number;
  /** Settles to the audio blob, or rejects (entry is dropped). */
  promise: Promise<Blob>;
  blob: Blob | null;
  abort: AbortController;
};

export type CloudSpeechEngineOptions = {
  /** Inject for tests; defaults to real /api/tts client. */
  synthesize?: typeof synthesizeCloudSpeech;
  /** Inject Audio constructor for tests. */
  createAudio?: () => HTMLAudioElement;
  getSpeaker: () => string;
  /** How many upcoming segments to keep warm (default 2). */
  prefetchDepth?: number;
};

/**
 * Adapter over Cloudflare Aura-2 (MP3 via /api/tts) + HTMLAudioElement.
 *
 * - Highlighting follows `audio.currentTime` (not wall-clock estimates).
 * - Prefetch queue keeps the next few segments ready so playback doesn’t
 *   stall between chunks while the network synthesizes.
 */
export class CloudSpeechEngine implements SpeechEngine {
  readonly id = "cloud" as const;
  /** Prefer slightly shorter chunks for tighter resync; prefetch hides the seams. */
  readonly maxChunkChars = Math.min(CLOUD_SPEECH_CHUNK, 520);

  private readonly synthesize: typeof synthesizeCloudSpeech;
  private readonly createAudio: () => HTMLAudioElement;
  private readonly getSpeaker: () => string;
  private readonly prefetchDepth: number;

  private audio: HTMLAudioElement | null = null;
  private objectUrl: string | null = null;
  /** Ordered upcoming segments (not including the one currently playing). */
  private queue: PrefetchEntry[] = [];
  private available: boolean | null = null;
  private highlightRaf: number | null = null;
  private lastHighlightChar = -1;
  /** Book text for keep-alive prefetch while a chunk plays. */
  private bookTextForPrefetch: string | null = null;

  constructor(options: CloudSpeechEngineOptions) {
    this.synthesize = options.synthesize ?? synthesizeCloudSpeech;
    this.createAudio =
      options.createAudio ??
      (() => {
        if (typeof Audio === "undefined") {
          throw new Error("HTMLAudioElement unavailable");
        }
        return new Audio();
      });
    this.getSpeaker = options.getSpeaker;
    this.prefetchDepth = Math.max(1, options.prefetchDepth ?? 2);
  }

  async probe(): Promise<boolean> {
    this.available = true;
    return true;
  }

  markAvailable(value: boolean) {
    this.available = value;
  }

  async speak(chunk: SpeechChunk, handlers: SpeakHandlers, signal: AbortSignal): Promise<void> {
    if (signal.aborted || !handlers.isCurrent()) {
      return;
    }

    // Resolve audio for this chunk (cache hit → instant; else synthesize).
    const blob = await this.resolveBlob(chunk, signal);

    if (signal.aborted || !handlers.isCurrent()) {
      return;
    }

    // Warm the next segments while this one plays (or while we already have them).
    if (this.bookTextForPrefetch) {
      this.prefetchFrom(this.bookTextForPrefetch, chunk.end);
    }

    handlers.onHighlight(chunk.start, "start");
    await this.playBlob(blob, chunk, handlers, signal);
  }

  /**
   * Ensure the next `prefetchDepth` segments after `from` are synthesizing / ready.
   * Safe to call repeatedly — does not abort in-flight work for still-needed chunks.
   */
  prefetchNext(bookText: string, from: number): void {
    this.bookTextForPrefetch = bookText;
    this.prefetchFrom(bookText, from);
  }

  private prefetchFrom(bookText: string, from: number): void {
    // Drop entries that are entirely before the cursor (stale after seek/skip).
    this.queue = this.queue.filter((entry) => {
      if (entry.end <= from) {
        entry.abort.abort();
        return false;
      }
      return true;
    });

    let cursor = from;
    const wanted: SpeechChunk[] = [];
    while (wanted.length < this.prefetchDepth) {
      const next = nextSpeechChunk(bookText, cursor, this.maxChunkChars);
      if (!next) {
        break;
      }
      wanted.push(next);
      cursor = next.end;
    }

    const wantedKeys = new Set(wanted.map((c) => keyOf(c.start, c.end)));

    // Abort queue items that are no longer in the lookahead window (e.g. seek).
    this.queue = this.queue.filter((entry) => {
      if (!wantedKeys.has(keyOf(entry.start, entry.end))) {
        entry.abort.abort();
        return false;
      }
      return true;
    });

    for (const chunk of wanted) {
      if (this.queue.some((e) => e.start === chunk.start && e.end === chunk.end)) {
        continue;
      }
      this.enqueue(chunk);
    }
  }

  private enqueue(chunk: SpeechChunk): void {
    const abort = new AbortController();
    const entry: PrefetchEntry = {
      start: chunk.start,
      end: chunk.end,
      blob: null,
      abort,
      promise: null as unknown as Promise<Blob>,
    };

    entry.promise = this.synthesize(chunk.text, this.getSpeaker(), abort.signal)
      .then((blob) => {
        entry.blob = blob;
        return blob;
      })
      .catch((error) => {
        // Drop failed entry so a later speak can retry.
        this.queue = this.queue.filter((e) => e !== entry);
        throw error;
      });

    // Avoid unhandled rejection noise when we abort on cancel.
    entry.promise.catch(() => {});

    this.queue.push(entry);
  }

  private async resolveBlob(chunk: SpeechChunk, signal: AbortSignal): Promise<Blob> {
    const idx = this.queue.findIndex((e) => e.start === chunk.start && e.end === chunk.end);
    if (idx !== -1) {
      const [entry] = this.queue.splice(idx, 1);
      try {
        const blob = entry.blob ?? (await entry.promise);
        if (signal.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }
        return blob;
      } catch (error) {
        if (signal.aborted || isAbortError(error)) {
          throw error instanceof Error ? error : new DOMException("Aborted", "AbortError");
        }
        // Fall through to live synthesize.
      }
    }

    return this.synthesize(chunk.text, this.getSpeaker(), signal);
  }

  private playBlob(
    blob: Blob,
    chunk: SpeechChunk,
    handlers: SpeakHandlers,
    signal: AbortSignal,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal.aborted || !handlers.isCurrent()) {
        resolve();
        return;
      }

      // Fresh element per segment — reusing one Audio keeps a stale `duration`
      // from the previous blob, which maps progress as 0 → 1 in one step
      // (highlight sits on the first word, then jumps to the end).
      if (this.audio) {
        try {
          this.audio.pause();
        } catch {
          // ignore
        }
        this.audio.removeAttribute("src");
        try {
          this.audio.load();
        } catch {
          // ignore
        }
      }
      this.releaseObjectUrl();
      this.stopHighlightLoop();
      this.lastHighlightChar = -1;

      const audio = this.createAudio();
      this.audio = audio;

      const objectUrl = URL.createObjectURL(blob);
      this.objectUrl = objectUrl;

      const words = wordsInChunkText(chunk.text);
      let lastWordIndex = -1;
      let lastProgress = 0;
      let closed = false;

      const onAbort = () => {
        cleanup();
        try {
          audio.pause();
        } catch {
          // ignore
        }
        resolve();
      };

      const cleanup = () => {
        if (closed) {
          return;
        }
        closed = true;
        signal.removeEventListener("abort", onAbort);
        this.stopHighlightLoop();
        audio.onended = null;
        audio.onerror = null;
        audio.onloadedmetadata = null;
        audio.ontimeupdate = null;
        audio.onplaying = null;
        audio.onpause = null;
        audio.oncanplay = null;
      };

      signal.addEventListener("abort", onAbort, { once: true });

      const emitWord = (wordIndex: number) => {
        if (!handlers.isCurrent() || !words.length) {
          return;
        }
        const index = Math.max(0, Math.min(words.length - 1, wordIndex));
        if (index === lastWordIndex) {
          return;
        }
        lastWordIndex = index;
        const charIndex = chunk.start + words[index].start;
        this.lastHighlightChar = charIndex;
        handlers.onHighlight(charIndex, "timed");
      };

      const syncFromAudio = () => {
        if (!handlers.isCurrent()) {
          return;
        }
        const progress = audioProgress(audio);
        if (progress == null) {
          return;
        }
        // Monotonic progress — currentTime can dip slightly on some engines.
        const p = Math.max(lastProgress, progress);
        lastProgress = p;
        emitWord(wordIndexForProgress(words.length, p, HIGHLIGHT_LEAD));
      };

      audio.ontimeupdate = () => {
        syncFromAudio();
      };

      audio.onplaying = () => {
        this.startHighlightLoop(syncFromAudio);
      };

      audio.onpause = () => {
        this.stopHighlightLoop();
        syncFromAudio();
      };

      audio.onended = () => {
        // Only settle on the last word if we actually tracked playback.
        // If the clock never started, stay on the first word rather than teleport.
        if (handlers.isCurrent() && words.length && lastWordIndex > 0) {
          emitWord(words.length - 1);
        }
        cleanup();
        this.releaseObjectUrl();
        resolve();
      };

      audio.onerror = () => {
        cleanup();
        this.releaseObjectUrl();
        reject(new Error("audio playback failed"));
      };

      audio.src = objectUrl;

      const startPlayback = () => {
        if (closed || signal.aborted || !handlers.isCurrent()) {
          if (!closed) {
            cleanup();
          }
          resolve();
          return;
        }

        void audio.play().then(
          () => {
            this.startHighlightLoop(syncFromAudio);
            syncFromAudio();
          },
          (error) => {
            cleanup();
            this.releaseObjectUrl();
            if (isAbortError(error) || signal.aborted) {
              resolve();
              return;
            }
            reject(error instanceof Error ? error : new Error("audio.play() failed"));
          },
        );
      };

      // Prefer starting only once duration is known so the first progress
      // sample is meaningful (avoids a stuck first-word highlight).
      let started = false;
      const tryStart = () => {
        if (started || closed) {
          return;
        }
        if (!Number.isFinite(audio.duration) || audio.duration <= 0) {
          return;
        }
        started = true;
        audio.onloadedmetadata = null;
        audio.oncanplay = null;
        startPlayback();
      };

      audio.onloadedmetadata = tryStart;
      audio.oncanplay = tryStart;

      // Blob URLs usually have metadata immediately; if not, don't wait forever.
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        tryStart();
      } else {
        setTimeout(() => {
          if (!started && !closed) {
            started = true;
            startPlayback();
          }
        }, 300);
      }
    });
  }

  private startHighlightLoop(tick: () => void) {
    this.stopHighlightLoop();
    const schedule =
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame.bind(globalThis)
        : (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 16) as unknown as number;
    const loop = () => {
      tick();
      this.highlightRaf = schedule(loop);
    };
    this.highlightRaf = schedule(loop);
  }

  private stopHighlightLoop() {
    if (this.highlightRaf != null) {
      if (typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(this.highlightRaf);
      } else {
        clearTimeout(this.highlightRaf);
      }
      this.highlightRaf = null;
    }
  }

  private releaseObjectUrl() {
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }

  private clearPrefetchQueue() {
    for (const entry of this.queue) {
      entry.abort.abort();
    }
    this.queue = [];
  }

  pause(): void {
    this.stopHighlightLoop();
    this.audio?.pause();
  }

  resume(): void {
    const audio = this.audio;
    if (!audio) {
      return;
    }
    void audio.play().catch(() => {
      // Player will re-speak the chunk if resume fails.
    });
  }

  cancel(): void {
    this.clearPrefetchQueue();
    this.bookTextForPrefetch = null;
    this.stopHighlightLoop();
    if (this.audio) {
      this.audio.onended = null;
      this.audio.onerror = null;
      this.audio.onloadedmetadata = null;
      this.audio.ontimeupdate = null;
      this.audio.onplaying = null;
      this.audio.onpause = null;
      this.audio.pause();
      this.audio.removeAttribute("src");
      try {
        this.audio.load();
      } catch {
        // ignore
      }
    }
    this.releaseObjectUrl();
  }

  dispose(): void {
    this.cancel();
    this.audio = null;
  }

  hasActiveAudio(): boolean {
    const audio = this.audio;
    return Boolean(audio && audio.src && !audio.ended && !audio.paused);
  }

  hasPausedAudio(): boolean {
    const audio = this.audio;
    return Boolean(audio && audio.src && !audio.ended && audio.paused);
  }

  /** Test helper: how many segments are currently warm / in-flight. */
  getPrefetchQueueSize(): number {
    return this.queue.length;
  }
}

const keyOf = (start: number, end: number) => `${start}:${end}`;

const isAbortError = (error: unknown) =>
  (error instanceof DOMException && error.name === "AbortError") ||
  (error instanceof Error && error.name === "AbortError");

// Re-export for tests that might want LocalWord typing through this module.
export type { LocalWord };
