import { BROWSER_SPEECH_CHUNK, type SpeechChunk } from "../chunking";
import type { SpeakHandlers, SpeechEngine } from "../types";
import { pickPreferredVoice, waitForBrowserVoices } from "../voices";

/**
 * Adapter over window.speechSynthesis.
 * Isolated so browser quirks (cancel/speak races, voice load) stay out of the player.
 */
export class BrowserSpeechEngine implements SpeechEngine {
  readonly id = "browser" as const;
  readonly maxChunkChars = BROWSER_SPEECH_CHUNK;

  private voice: SpeechSynthesisVoice | null = null;
  private utterance: SpeechSynthesisUtterance | null = null;
  private available: boolean | null = null;

  async probe(): Promise<boolean> {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      this.available = false;
      return false;
    }
    const voices = await waitForBrowserVoices();
    this.voice = pickPreferredVoice(voices);
    this.available = true;
    return true;
  }

  async speak(chunk: SpeechChunk, handlers: SpeakHandlers, signal: AbortSignal): Promise<void> {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      throw new Error("speechSynthesis unavailable");
    }
    if (signal.aborted || !handlers.isCurrent()) {
      return;
    }

    if (!this.voice) {
      this.voice = pickPreferredVoice(window.speechSynthesis.getVoices());
    }

    // cancel()+speak() in the same turn often drops audio in Chrome.
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 40);
    });
    if (signal.aborted || !handlers.isCurrent()) {
      return;
    }

    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
    }

    await new Promise<void>((resolve, reject) => {
      if (signal.aborted || !handlers.isCurrent()) {
        resolve();
        return;
      }

      const utterance = new SpeechSynthesisUtterance(chunk.text);
      utterance.rate = 1;
      if (this.voice) {
        utterance.voice = this.voice;
        utterance.lang = this.voice.lang;
      }
      this.utterance = utterance;

      const onAbort = () => {
        window.speechSynthesis.cancel();
        cleanup();
        resolve();
      };

      const cleanup = () => {
        signal.removeEventListener("abort", onAbort);
        utterance.onstart = null;
        utterance.onend = null;
        utterance.onerror = null;
        utterance.onboundary = null;
        if (this.utterance === utterance) {
          this.utterance = null;
        }
      };

      signal.addEventListener("abort", onAbort, { once: true });

      utterance.onstart = () => {
        if (!handlers.isCurrent()) {
          return;
        }
        handlers.onHighlight(chunk.start, "start");
      };

      utterance.onboundary = (event) => {
        if (!handlers.isCurrent()) {
          return;
        }
        if ((event.name === "word" || event.charLength) && typeof event.charIndex === "number") {
          handlers.onHighlight(chunk.start + event.charIndex, "boundary");
        }
      };

      utterance.onend = () => {
        cleanup();
        resolve();
      };

      utterance.onerror = (event) => {
        cleanup();
        if (event.error === "interrupted" || event.error === "canceled") {
          resolve();
          return;
        }
        reject(new Error(event.error || "speechSynthesis error"));
      };

      window.speechSynthesis.speak(utterance);
    });
  }

  pause(): void {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.pause();
    }
  }

  resume(): void {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.resume();
    }
  }

  cancel(): void {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    this.utterance = null;
  }

  dispose(): void {
    this.cancel();
    this.voice = null;
  }
}
