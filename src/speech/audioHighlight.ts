/**
 * Map HTMLAudioElement playback progress → book character index.
 * Used by cloud TTS (no SpeechSynthesis boundary events).
 *
 * Aura does not return word timestamps, so we map audio progress → word index
 * with equal time per word. That is more stable than character-rate or pause
 * heuristics, which drift badly against real TTS pacing.
 */

export type LocalWord = {
  /** Offset within the chunk text. */
  start: number;
  end: number;
  text: string;
};

export const wordsInChunkText = (text: string): LocalWord[] => {
  const words: LocalWord[] = [];
  const re = /\S+/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    words.push({
      start: match.index,
      end: match.index + match[0].length,
      text: match[0],
    });
  }
  return words;
};

/**
 * Word index for a 0–1 progress value (equal time per word).
 */
export const wordIndexForProgress = (wordCount: number, progress: number, lead = 0): number => {
  if (wordCount <= 0) {
    return 0;
  }
  const p = Math.min(1, Math.max(0, progress + lead));
  if (p <= 0) {
    return 0;
  }
  if (p >= 1) {
    return wordCount - 1;
  }
  // floor(p * n) with p in [0,1) → [0, n-1]
  return Math.min(wordCount - 1, Math.floor(p * wordCount));
};

/**
 * Convert audio progress (0–1) into an absolute character index for highlighting.
 *
 * @param lead - Optional progress lead (e.g. 0.02 ≈ slightly ahead of audio).
 */
export const charIndexForAudioProgress = (
  chunkStart: number,
  chunkText: string,
  progress: number,
  options?: { words?: LocalWord[]; lead?: number },
): number => {
  const words = options?.words ?? wordsInChunkText(chunkText);

  if (!chunkText.length) {
    return chunkStart;
  }

  if (!words.length) {
    const lead = options?.lead ?? 0;
    const p = Math.min(1, Math.max(0, progress + lead));
    return chunkStart + Math.min(chunkText.length - 1, Math.floor(p * chunkText.length));
  }

  const index = wordIndexForProgress(words.length, progress, options?.lead ?? 0);
  return chunkStart + words[index].start;
};

/**
 * Compute playback progress from an audio element.
 * Returns null when duration is unknown (caller should skip).
 */
export const audioProgress = (audio: { currentTime: number; duration: number }): number | null => {
  const { currentTime, duration } = audio;
  // HTMLMediaElement uses NaN / Infinity while metadata is loading.
  if (!Number.isFinite(duration) || duration <= 0) {
    return null;
  }
  if (!Number.isFinite(currentTime) || currentTime < 0) {
    return 0;
  }
  return Math.min(1, Math.max(0, currentTime / duration));
};
