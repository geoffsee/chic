import { describe, expect, test } from "bun:test";
import {
  audioProgress,
  charIndexForAudioProgress,
  wordIndexForProgress,
  wordsInChunkText,
} from "../src/speech/audioHighlight";

describe("wordsInChunkText", () => {
  test("indexes words within the chunk", () => {
    const words = wordsInChunkText("Call me Ishmael.");
    expect(words.map((w) => w.text)).toEqual(["Call", "me", "Ishmael."]);
    expect(words[0]).toMatchObject({ start: 0, end: 4 });
    expect(words[1]).toMatchObject({ start: 5, end: 7 });
  });
});

describe("wordIndexForProgress", () => {
  test("maps progress evenly across words", () => {
    // 6 words → each ~1/6 of the clip
    expect(wordIndexForProgress(6, 0)).toBe(0);
    expect(wordIndexForProgress(6, 0.1)).toBe(0);
    expect(wordIndexForProgress(6, 0.2)).toBe(1);
    expect(wordIndexForProgress(6, 0.5)).toBe(3);
    expect(wordIndexForProgress(6, 0.99)).toBe(5);
    expect(wordIndexForProgress(6, 1)).toBe(5);
  });

  test("lead advances the index slightly", () => {
    const without = wordIndexForProgress(10, 0.2, 0);
    const withLead = wordIndexForProgress(10, 0.2, 0.15);
    expect(withLead).toBeGreaterThanOrEqual(without);
  });
});

describe("charIndexForAudioProgress", () => {
  const chunkStart = 100;
  const text = "Call me Ishmael and set sail.";
  // 6 words

  test("starts at the first word", () => {
    expect(charIndexForAudioProgress(chunkStart, text, 0)).toBe(chunkStart);
  });

  test("advances to later words as progress increases", () => {
    const early = charIndexForAudioProgress(chunkStart, text, 0.1);
    const mid = charIndexForAudioProgress(chunkStart, text, 0.5);
    const late = charIndexForAudioProgress(chunkStart, text, 0.95);

    expect(early).toBe(chunkStart); // "Call"
    expect(mid).toBeGreaterThan(early);
    expect(late).toBeGreaterThan(mid);
    expect(late).toBe(chunkStart + text.lastIndexOf("sail."));
  });

  test("equal time per word — short and long words step by index, not char span", () => {
    const uneven = "I supercalifragilisticexpialidocious hi";
    const words = wordsInChunkText(uneven);
    // 3 words: progress in the middle third → long word
    const idx = charIndexForAudioProgress(0, uneven, 0.5, { words, lead: 0 });
    expect(idx).toBe(words[1].start);
    // Last third → "hi"
    const last = charIndexForAudioProgress(0, uneven, 0.9, { words, lead: 0 });
    expect(last).toBe(words[2].start);
  });

  test("lead nudges highlight slightly ahead", () => {
    const text2 = "one two three four five six";
    const without = charIndexForAudioProgress(0, text2, 0.2, { lead: 0 });
    const withLead = charIndexForAudioProgress(0, text2, 0.2, { lead: 0.15 });
    expect(withLead).toBeGreaterThanOrEqual(without);
  });

  test("clamps progress outside 0–1", () => {
    expect(charIndexForAudioProgress(chunkStart, text, -1)).toBe(chunkStart);
    const end = charIndexForAudioProgress(chunkStart, text, 2);
    expect(end).toBe(chunkStart + text.lastIndexOf("sail."));
  });

  test("does not jump from first word to last for mid progress", () => {
    // Regression: stale duration previously made progress look like 0 then 1,
    // so the UI only ever showed the first word after a period and then the end.
    const sentence =
      "After the storm. The sailors checked the sails and the ropes carefully today.";
    const words = wordsInChunkText(sentence);
    expect(words.length).toBeGreaterThan(5);

    const positions = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8].map((p) =>
      charIndexForAudioProgress(0, sentence, p, { words, lead: 0 }),
    );

    // Strictly non-decreasing and visits more than two distinct words.
    for (let i = 1; i < positions.length; i += 1) {
      expect(positions[i]).toBeGreaterThanOrEqual(positions[i - 1]);
    }
    const unique = new Set(positions);
    expect(unique.size).toBeGreaterThan(2);
    // Mid progress must not be the final word.
    expect(positions[3]).toBeLessThan(words[words.length - 1].start);
  });
});

describe("audioProgress", () => {
  test("returns null when duration is unknown", () => {
    expect(audioProgress({ currentTime: 1, duration: NaN })).toBeNull();
    expect(audioProgress({ currentTime: 1, duration: 0 })).toBeNull();
    expect(audioProgress({ currentTime: 1, duration: Infinity })).toBeNull();
  });

  test("maps currentTime into 0–1", () => {
    expect(audioProgress({ currentTime: 0, duration: 10 })).toBe(0);
    expect(audioProgress({ currentTime: 5, duration: 10 })).toBe(0.5);
    expect(audioProgress({ currentTime: 12, duration: 10 })).toBe(1);
  });
});
