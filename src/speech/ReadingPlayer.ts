import { DEFAULT_CLOUD_SPEAKER, fetchCloudTtsStatus } from "../services/cloudTts";
import { nextSpeechChunk } from "./chunking";
import { COPY, engineHelp, engineLabel } from "./copy";
import type {
  EngineId,
  PlayerListeners,
  PlayerNotice,
  PlayerPhase,
  PlayerSnapshot,
  SpeechEngine,
} from "./types";

export type ReadingPlayerOptions = {
  engines: SpeechEngine[];
  listeners: PlayerListeners;
  /**
   * Preferred engine order for *initial* selection only.
   * Mid-session failover is never silent — see `autoFallback`.
   */
  preference?: EngineId[];
  /**
   * When true, automatically switch engines on failure (surprising).
   * Default false: stop and let the user choose how to continue.
   */
  autoFallback?: boolean;
  fetchStatus?: typeof fetchCloudTtsStatus;
  defaultSpeaker?: string;
};

/**
 * Framework-free reading orchestrator.
 *
 * UX contract:
 * - Never change voice quality mid-session without an explicit user action
 *   (unless autoFallback is opted in).
 * - Surface buffering so silence isn’t mistaken for “stuck”.
 * - Status copy is human-readable (see copy.ts).
 */
export class ReadingPlayer {
  private readonly engines: Map<EngineId, SpeechEngine>;
  private readonly preference: EngineId[];
  private readonly autoFallback: boolean;
  private readonly listeners: PlayerListeners;
  private readonly fetchStatus: typeof fetchCloudTtsStatus;

  private text = "";
  private speaker = DEFAULT_CLOUD_SPEAKER;
  private cursor = 0;
  private generation = 0;
  private phase: PlayerPhase = "idle";
  private paused = false;
  private ready = false;
  private cloudAvailable = false;
  private browserAvailable = false;
  private activeEngineId: EngineId | null = null;
  /** User lock: once set, prepare/start honor this over auto preference. */
  private userEngineChoice: EngineId | null = null;
  private statusMessage: string | null = null;
  private detailMessage: string | null = null;
  private notice: PlayerNotice | null = null;
  private sessionAbort: AbortController | null = null;
  private runPromise: Promise<void> | null = null;

  constructor(options: ReadingPlayerOptions) {
    this.engines = new Map(options.engines.map((engine) => [engine.id, engine]));
    this.preference = options.preference ?? ["cloud", "browser"];
    this.autoFallback = options.autoFallback ?? false;
    this.listeners = options.listeners;
    this.fetchStatus = options.fetchStatus ?? fetchCloudTtsStatus;
    this.speaker = options.defaultSpeaker ?? DEFAULT_CLOUD_SPEAKER;
  }

  getSnapshot(): PlayerSnapshot {
    return {
      phase: this.phase,
      speaking: this.phase === "speaking" || this.phase === "loading" || this.phase === "buffering",
      paused: this.paused,
      ready: this.ready,
      engine: this.activeEngineId,
      statusMessage: this.statusMessage,
      detailMessage: this.detailMessage,
      speaker: this.speaker,
      cloudAvailable: this.cloudAvailable,
      browserAvailable: this.browserAvailable,
      notice: this.notice,
    };
  }

  private emit() {
    this.listeners.onSnapshot(this.getSnapshot());
  }

  private setPhase(phase: PlayerPhase) {
    this.phase = phase;
    this.emit();
  }

  private setStatus(status: string | null, detail: string | null = null) {
    this.statusMessage = status;
    this.detailMessage = detail;
    this.emit();
  }

  private setNotice(notice: PlayerNotice | null) {
    this.notice = notice;
    this.emit();
  }

  setText(text: string) {
    this.text = text;
  }

  setSpeaker(speaker: string) {
    this.speaker = speaker;
    if (this.cloudAvailable) {
      this.activeEngineId = this.activeEngineId ?? "cloud";
      const appliesLater =
        this.phase === "speaking" || this.phase === "paused" || this.phase === "buffering";
      this.setStatus(engineHelp("cloud", speaker), appliesLater ? COPY.speakerAppliesNext : null);
    }
  }

  getSpeaker() {
    return this.speaker;
  }

  /**
   * Explicit engine choice from the UI (avoids surprise switches).
   * Takes effect on the next start/retry.
   */
  preferEngine(id: EngineId) {
    if (id === "cloud" && !this.cloudAvailable) {
      return;
    }
    if (id === "browser" && !this.browserAvailable) {
      return;
    }
    this.userEngineChoice = id;
    this.activeEngineId = id;
    this.notice = null;
    this.setStatus(engineHelp(id, this.speaker), null);
  }

  async prepare(): Promise<void> {
    this.setStatus(COPY.preparing, null);

    const status = await this.fetchStatus();
    this.cloudAvailable = Boolean(status.available);
    if (status.defaultSpeaker) {
      this.speaker = status.defaultSpeaker;
    }

    this.engines.get("cloud")?.markAvailable?.(this.cloudAvailable);

    const browser = this.engines.get("browser");
    if (browser) {
      this.browserAvailable = await browser.probe().catch(() => false);
    } else {
      this.browserAvailable = false;
    }

    if (this.userEngineChoice === "cloud" && !this.cloudAvailable) {
      this.userEngineChoice = null;
    }
    if (this.userEngineChoice === "browser" && !this.browserAvailable) {
      this.userEngineChoice = null;
    }

    if (this.cloudAvailable || this.browserAvailable) {
      this.activeEngineId = this.pickEngineId();
      this.ready = true;
      this.setStatus(engineHelp(this.activeEngineId, this.speaker), null);
    } else {
      this.ready = false;
      this.activeEngineId = null;
      this.setStatus(COPY.noneReady, null);
    }
  }

  start(fromChar: number) {
    if (!this.ready || !this.text.trim()) {
      return;
    }

    this.notice = null;
    this.detailMessage = null;
    this.stopInternal(/* emitIdle */ false);

    const generation = this.generation;
    this.cursor = Math.max(0, fromChar);
    this.paused = false;
    this.activeEngineId = this.pickEngineId();
    this.statusMessage = engineHelp(this.activeEngineId, this.speaker);
    this.detailMessage = COPY.starting;
    this.setPhase("loading");
    this.listeners.onHighlight(this.cursor, "start");

    const controller = new AbortController();
    this.sessionAbort = controller;
    this.runPromise = this.runLoop(generation, controller.signal).finally(() => {
      if (this.generation === generation) {
        this.runPromise = null;
      }
    });
  }

  pause() {
    if (this.phase !== "speaking" && this.phase !== "loading" && this.phase !== "buffering") {
      return;
    }
    this.paused = true;
    this.detailMessage = null;
    this.engines.get(this.activeEngineId ?? "browser")?.pause();
    this.setPhase("paused");
  }

  resume() {
    if (!this.paused) {
      return;
    }
    this.paused = false;
    this.detailMessage = null;
    this.setPhase("speaking");

    const engine = this.engines.get(this.activeEngineId ?? "browser");

    if (engine?.hasPausedAudio?.()) {
      engine.resume();
      return;
    }

    engine?.resume();
    if (!this.runPromise) {
      this.start(this.cursor);
    }
  }

  stop() {
    this.detailMessage = null;
    this.notice = null;
    this.stopInternal(true);
    if (this.activeEngineId) {
      this.statusMessage = engineHelp(this.activeEngineId, this.speaker);
    }
    this.emit();
  }

  /** User chose "Try again" after an error. */
  retry() {
    this.notice = null;
    this.start(this.cursor);
  }

  /** User explicitly chose device voice after natural voice failed. */
  useDeviceVoiceAndContinue() {
    if (!this.browserAvailable) {
      this.setNotice({
        kind: "error",
        message: COPY.noneReady,
        actions: ["dismiss"],
      });
      return;
    }
    this.userEngineChoice = "browser";
    this.activeEngineId = "browser";
    this.notice = null;
    this.setStatus(engineHelp("browser"), null);
    this.start(this.cursor);
  }

  dismissNotice() {
    this.notice = null;
    if (this.phase === "error") {
      this.setPhase("idle");
    } else {
      this.emit();
    }
  }

  dispose() {
    this.stopInternal(false);
    for (const engine of this.engines.values()) {
      engine.dispose();
    }
  }

  private stopInternal(emitIdle: boolean) {
    this.generation += 1;
    this.paused = false;
    this.sessionAbort?.abort();
    this.sessionAbort = null;
    this.runPromise = null;
    for (const engine of this.engines.values()) {
      engine.cancel();
    }
    if (emitIdle) {
      this.detailMessage = null;
      this.setPhase("idle");
    } else {
      this.phase = "idle";
    }
  }

  private pickEngineId(): EngineId {
    if (this.userEngineChoice) {
      if (this.userEngineChoice === "cloud" && this.cloudAvailable) {
        return "cloud";
      }
      if (this.userEngineChoice === "browser" && this.browserAvailable) {
        return "browser";
      }
    }

    for (const id of this.preference) {
      if (id === "cloud" && this.cloudAvailable && this.engines.has("cloud")) {
        return "cloud";
      }
      if (id === "browser" && this.browserAvailable && this.engines.has("browser")) {
        return "browser";
      }
    }

    const first = this.engines.keys().next().value as EngineId | undefined;
    if (!first) {
      throw new Error("No speech engines registered");
    }
    return first;
  }

  private isCurrent(generation: number) {
    return this.generation === generation;
  }

  private async runLoop(generation: number, signal: AbortSignal) {
    let engineId = this.activeEngineId ?? this.pickEngineId();
    this.activeEngineId = engineId;

    while (this.isCurrent(generation) && !signal.aborted) {
      if (this.paused) {
        await this.waitWhilePaused(generation, signal);
        if (!this.isCurrent(generation) || signal.aborted) {
          return;
        }
      }

      const engine = this.engines.get(engineId);
      if (!engine) {
        this.failSession(COPY.playFailed, ["retry", "dismiss"]);
        return;
      }

      const chunk = nextSpeechChunk(this.text, this.cursor, engine.maxChunkChars);
      if (!chunk) {
        this.detailMessage = null;
        this.setPhase("idle");
        return;
      }

      // Prefetch the *next* segments while this one synthesizes/plays — not after it ends.
      // (Previously we only prefetched after speak resolved, so every segment waited on the network.)
      engine.prefetchNext?.(this.text, chunk.end);

      // Show buffering *before* network/synthesis so silence isn’t “stuck Reading”.
      this.detailMessage = engineId === "cloud" ? COPY.buffering : COPY.starting;
      this.setPhase("buffering");
      this.listeners.onHighlight(chunk.start, "start");

      try {
        await engine.speak(
          chunk,
          {
            isCurrent: () => this.isCurrent(generation) && !signal.aborted,
            onHighlight: (charIndex, source) => {
              if (!this.isCurrent(generation)) {
                return;
              }
              // First real highlight means audio has started.
              if (this.phase === "buffering" || this.phase === "loading") {
                this.detailMessage = null;
                this.phase = "speaking";
                this.emit();
              }
              // Cloud engines drive sync via audio.currentTime → onHighlight("timed").
              // Browser engines use SpeechSynthesis boundary events.
              this.listeners.onHighlight(charIndex, source);
            },
          },
          signal,
        );

        if (!this.isCurrent(generation) || signal.aborted) {
          return;
        }

        this.cursor = chunk.end;
        // Top up the lookahead window as we advance.
        engine.prefetchNext?.(this.text, this.cursor);
      } catch (error) {
        if (!this.isCurrent(generation) || signal.aborted) {
          return;
        }

        if (this.autoFallback) {
          const fallback = this.nextFallback(engineId);
          if (fallback) {
            console.warn(`[ReadingPlayer] ${engineId} failed, falling back to ${fallback}:`, error);
            engineId = fallback;
            this.activeEngineId = fallback;
            this.userEngineChoice = fallback;
            this.setStatus(
              engineHelp(fallback, this.speaker),
              `Switched to ${engineLabel(fallback).toLowerCase()} after a playback issue.`,
            );
            continue;
          }
        }

        // Default: stop and ask — never surprise with a different voice.
        if (engineId === "cloud" && this.browserAvailable) {
          this.failSession(COPY.cloudFailed, ["retry", "use-device-voice", "dismiss"]);
        } else {
          this.failSession(COPY.playFailed, ["retry", "dismiss"]);
        }
        return;
      }
    }
  }

  private failSession(message: string, actions: PlayerNotice["actions"]) {
    this.detailMessage = null;
    this.notice = {
      kind: "error",
      message,
      actions,
    };
    this.setPhase("error");
  }

  private nextFallback(from: EngineId): EngineId | null {
    const index = this.preference.indexOf(from);
    for (let i = index + 1; i < this.preference.length; i += 1) {
      const id = this.preference[i];
      if (id === "browser" && this.browserAvailable && this.engines.has("browser")) {
        return "browser";
      }
      if (id === "cloud" && this.cloudAvailable && this.engines.has("cloud")) {
        return "cloud";
      }
    }
    return null;
  }

  private waitWhilePaused(generation: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      if (!this.paused || !this.isCurrent(generation) || signal.aborted) {
        resolve();
        return;
      }

      const started = Date.now();
      const poll = () => {
        if (!this.isCurrent(generation) || signal.aborted || !this.paused) {
          resolve();
          return;
        }
        if (Date.now() - started > 1000 * 60 * 60) {
          resolve();
          return;
        }
        setTimeout(poll, 50);
      };
      poll();
    });
  }
}
