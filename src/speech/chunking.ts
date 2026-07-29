/** Browser engines stall on long strings; cloud TTS can handle larger phrases. */
export const BROWSER_SPEECH_CHUNK = 280;
export const CLOUD_SPEECH_CHUNK = 700;

export type SpeechChunk = {
  text: string;
  start: number;
  end: number;
};

/**
 * Split book text into short speakable chunks, preferring sentence boundaries.
 * Pure function — no I/O, safe to unit test exhaustively.
 */
export const nextSpeechChunk = (
  text: string,
  from: number,
  maxChars: number,
): SpeechChunk | null => {
  const length = text.length;
  let start = from;
  while (start < length && /\s/.test(text[start])) {
    start += 1;
  }
  if (start >= length) {
    return null;
  }

  const hardLimit = Math.min(length, start + maxChars);
  let end = hardLimit;

  if (hardLimit < length) {
    const window = text.slice(start, hardLimit);
    const sentenceBreak = Math.max(
      window.lastIndexOf(". "),
      window.lastIndexOf("! "),
      window.lastIndexOf("? "),
      window.lastIndexOf(".\n"),
      window.lastIndexOf("!\n"),
      window.lastIndexOf("?\n"),
      window.lastIndexOf("\n\n"),
    );
    if (sentenceBreak > 40) {
      end = start + sentenceBreak + 1;
    } else {
      const spaceBreak = window.lastIndexOf(" ");
      if (spaceBreak > 40) {
        end = start + spaceBreak;
      }
    }
  }

  const chunk = text.slice(start, end);
  if (!chunk.trim()) {
    return null;
  }

  return { text: chunk, start, end };
};
