import type { SpeechChunk } from "./chunking";

export type { SpeechChunk };

/** Preferred order: cloud first when available, browser as safety net. */
export type EngineId = "cloud" | "browser";

export type HighlightSource = "start" | "boundary" | "timed";

export type PlayerPhase = "idle" | "loading" | "buffering" | "speaking" | "paused" | "error";

/** Transient UX notice — never silent policy changes. */
export type PlayerNotice = {
  kind: "info" | "warning" | "error";
  message: string;
  /** Recovery actions shown to the user (explicit, not automatic). */
  actions?: Array<"retry" | "use-device-voice" | "dismiss">;
};

export type PlayerSnapshot = {
  phase: PlayerPhase;
  /** True when Play should look “active” (including buffer/load). */
  speaking: boolean;
  paused: boolean;
  ready: boolean;
  engine: EngineId | null;
  /** Primary status line (always human-readable). */
  statusMessage: string | null;
  /** Secondary line for transient state (buffering, etc.). */
  detailMessage: string | null;
  speaker: string;
  cloudAvailable: boolean;
  browserAvailable: boolean;
  notice: PlayerNotice | null;
};

export type SpeakHandlers = {
  /** True while this speak request still owns the session. */
  isCurrent: () => boolean;
  /**
   * Engines call this as speech progresses.
   * - browser: SpeechSynthesis word boundary events
   * - cloud: audio.currentTime mapped onto the chunk
   */
  onHighlight: (charIndex: number, source: HighlightSource) => void;
};

/**
 * Port for a single TTS backend.
 * Engines must not know about React, books, or sessions.
 */
export interface SpeechEngine {
  readonly id: EngineId;
  /** Preferred max characters per speak call for this engine. */
  readonly maxChunkChars: number;

  /** Capability probe (cheap; may hit network for cloud). */
  probe(): Promise<boolean>;

  /**
   * Speak one chunk. Resolves when the chunk finishes (or is cancelled).
   * Rejects on hard failure so the player can fall back.
   */
  speak(chunk: SpeechChunk, handlers: SpeakHandlers, signal: AbortSignal): Promise<void>;

  pause(): void;
  resume(): void;
  /** Hard stop any in-flight audio/utterance owned by this engine. */
  cancel(): void;
  dispose(): void;

  /** Optional: mark remote availability after a status probe. */
  markAvailable?(available: boolean): void;
  /**
   * Optional: warm the next segment(s) starting at `fromChar`.
   * Call when the current chunk is known (before/during speak), not only after it ends.
   */
  prefetchNext?(bookText: string, fromChar: number): void;
  /** Optional: true when media is paused mid-chunk and can resume. */
  hasPausedAudio?(): boolean;
}

export type PlayerListeners = {
  onSnapshot: (snapshot: PlayerSnapshot) => void;
  onHighlight: (charIndex: number, source: HighlightSource) => void;
};
