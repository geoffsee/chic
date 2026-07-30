import { t } from "../i18n";
import type { EngineId } from "./types";

/** User-facing labels — never expose env vars, model ids, or stack jargon. */
export const engineLabel = (id: EngineId | null): string => {
  if (id === "cloud") {
    return t("speech.engine.cloud");
  }
  if (id === "browser") {
    return t("speech.engine.browser");
  }
  return t("speech.engine.generic");
};

export const engineHelp = (id: EngineId | null, speaker?: string): string => {
  if (id === "cloud") {
    const name = speaker ? speaker.charAt(0).toUpperCase() + speaker.slice(1) : "Luna";
    return t("speech.engineHelp.cloud", { name });
  }
  if (id === "browser") {
    return t("speech.engineHelp.browser");
  }
  return t("speech.engineHelp.checking");
};

export const phaseLabel = (phase: string, paused: boolean): string => {
  if (paused || phase === "paused") {
    return t("speech.phase.paused");
  }
  switch (phase) {
    case "loading":
      return t("speech.phase.starting");
    case "buffering":
      return t("speech.phase.buffering");
    case "speaking":
      return t("speech.phase.reading");
    case "error":
      return t("speech.phase.play");
    default:
      return t("speech.phase.play");
  }
};

/** Locale-aware speech status strings (reads active UI locale). */
export const COPY = {
  get preparing() {
    return t("speech.preparing");
  },
  get naturalReady() {
    return t("speech.naturalReady");
  },
  get deviceReady() {
    return t("speech.deviceReady");
  },
  get noneReady() {
    return t("speech.noneReady");
  },
  get buffering() {
    return t("speech.buffering");
  },
  get starting() {
    return t("speech.starting");
  },
  get cloudFailed() {
    return t("speech.cloudFailed");
  },
  get playFailed() {
    return t("speech.playFailed");
  },
  get speakerAppliesNext() {
    return t("speech.speakerAppliesNext");
  },
  get bookLoading() {
    return t("speech.bookLoading");
  },
} as const;
