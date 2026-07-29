export type CloudTtsStatus = {
  available: boolean;
  model?: string;
  defaultSpeaker?: string;
  speakers?: string[];
  engine?: string;
};

export const DEFAULT_CLOUD_SPEAKER = "luna";

/** Recommended Aura-2 voices for audiobook-style reading. */
export const FEATURED_SPEAKERS = [
  { id: "luna", label: "Luna (warm)" },
  { id: "asteria", label: "Asteria (clear)" },
  { id: "athena", label: "Athena (steady)" },
  { id: "orion", label: "Orion (deep)" },
  { id: "arcas", label: "Arcas (soft)" },
  { id: "hera", label: "Hera (bright)" },
  { id: "zeus", label: "Zeus (bold)" },
  { id: "orpheus", label: "Orpheus (narrative)" },
] as const;

export async function fetchCloudTtsStatus(): Promise<CloudTtsStatus> {
  try {
    const response = await fetch("/api/tts");
    if (!response.ok) {
      return { available: false };
    }
    const payload = (await response.json()) as CloudTtsStatus;
    return {
      available: Boolean(payload.available),
      model: payload.model,
      defaultSpeaker: payload.defaultSpeaker ?? DEFAULT_CLOUD_SPEAKER,
      speakers: Array.isArray(payload.speakers) ? payload.speakers : [],
      engine: payload.engine,
    };
  } catch {
    return { available: false };
  }
}

export async function synthesizeCloudSpeech(
  text: string,
  speaker: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const response = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, speaker }),
    signal,
  });

  if (!response.ok) {
    let message = `TTS failed (${response.status})`;
    try {
      const payload = (await response.json()) as { error?: string };
      if (payload.error) {
        message = payload.error;
      }
    } catch {
      // ignore non-JSON errors
    }
    throw new Error(message);
  }

  return response.blob();
}
