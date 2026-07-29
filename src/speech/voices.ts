/** Prefer a local English voice once the browser finishes loading them. */
export const pickPreferredVoice = (voices: SpeechSynthesisVoice[]) => {
  if (!voices.length) {
    return null;
  }

  const english = voices.filter((voice) => /^en(-|_|$)/i.test(voice.lang));
  const pool = english.length ? english : voices;
  return (
    pool.find((voice) => voice.default) ??
    pool.find((voice) =>
      /samantha|daniel|alex|google us english|microsoft (aria|guy)/i.test(voice.name),
    ) ??
    pool[0] ??
    null
  );
};

/**
 * Wait until the browser exposes at least one voice, or the timeout elapses.
 * Callers should still allow playback after timeout (default voice).
 */
export const waitForBrowserVoices = (
  timeoutMs = 2500,
): Promise<SpeechSynthesisVoice[]> => {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    return Promise.resolve([]);
  }

  const existing = window.speechSynthesis.getVoices();
  if (existing.length) {
    return Promise.resolve(existing);
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (voices: SpeechSynthesisVoice[]) => {
      if (settled) {
        return;
      }
      settled = true;
      window.speechSynthesis.removeEventListener("voiceschanged", onChange);
      window.clearInterval(pollId);
      window.clearTimeout(timeoutId);
      resolve(voices);
    };

    const onChange = () => {
      const voices = window.speechSynthesis.getVoices();
      if (voices.length) {
        finish(voices);
      }
    };

    window.speechSynthesis.addEventListener("voiceschanged", onChange);

    const pollId = window.setInterval(() => {
      const voices = window.speechSynthesis.getVoices();
      if (voices.length) {
        finish(voices);
      }
    }, 150);

    const timeoutId = window.setTimeout(() => {
      finish(window.speechSynthesis.getVoices());
    }, timeoutMs);

    // Kick load on engines that only populate after getVoices().
    window.speechSynthesis.getVoices();
  });
};
