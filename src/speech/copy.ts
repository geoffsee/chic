import type { EngineId } from "./types";

/** User-facing labels — never expose env vars, model ids, or stack jargon. */
export const engineLabel = (id: EngineId | null): string => {
  if (id === "cloud") {
    return "Natural voice";
  }
  if (id === "browser") {
    return "Device voice";
  }
  return "Voice";
};

export const engineHelp = (id: EngineId | null, speaker?: string): string => {
  if (id === "cloud") {
    const name = speaker ? speaker.charAt(0).toUpperCase() + speaker.slice(1) : "Luna";
    return `Natural voice · ${name}`;
  }
  if (id === "browser") {
    return "Device voice · quality depends on your browser";
  }
  return "Checking which voices are available…";
};

export const phaseLabel = (phase: string, paused: boolean): string => {
  if (paused || phase === "paused") {
    return "Paused";
  }
  switch (phase) {
    case "loading":
      return "Starting…";
    case "buffering":
      return "Loading audio…";
    case "speaking":
      return "Reading";
    case "error":
      return "Play";
    default:
      return "Play";
  }
};

export const COPY = {
  preparing: "Getting voices ready…",
  naturalReady: "Natural voice ready",
  deviceReady: "Device voice ready",
  noneReady: "Reading aloud isn’t available in this browser.",
  buffering: "Loading the next bit of audio…",
  starting: "Starting playback…",
  cloudFailed:
    "The natural voice couldn’t play. You can try again or continue with your device’s voice.",
  playFailed: "Playback stopped unexpectedly. Tap Play to continue from here.",
  speakerAppliesNext: "Voice change applies the next time you press Play.",
  bookLoading: "Load a book to start listening.",
} as const;
