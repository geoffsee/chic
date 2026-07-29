import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_CLOUD_SPEAKER, FEATURED_SPEAKERS } from "../services/cloudTts";
import { BrowserSpeechEngine } from "./engines/browserSpeechEngine";
import { CloudSpeechEngine } from "./engines/cloudSpeechEngine";
import { ReadingPlayer } from "./ReadingPlayer";
import type { EngineId, HighlightSource, PlayerSnapshot } from "./types";

const idleSnapshot = (): PlayerSnapshot => ({
  phase: "idle",
  speaking: false,
  paused: false,
  ready: false,
  engine: null,
  statusMessage: null,
  detailMessage: null,
  speaker: DEFAULT_CLOUD_SPEAKER,
  cloudAvailable: false,
  browserAvailable: false,
  notice: null,
});

export type UseReadingPlayerArgs = {
  bookText: string;
  onHighlightChar: (charIndex: number, source: HighlightSource) => void;
};

/**
 * Thin React binding around ReadingPlayer.
 * UI components should not import engines or chunking directly.
 */
export function useReadingPlayer({ bookText, onHighlightChar }: UseReadingPlayerArgs) {
  const [snapshot, setSnapshot] = useState<PlayerSnapshot>(idleSnapshot);
  const playerRef = useRef<ReadingPlayer | null>(null);
  const speakerRef = useRef(DEFAULT_CLOUD_SPEAKER);

  const onHighlightRef = useRef(onHighlightChar);
  onHighlightRef.current = onHighlightChar;

  useEffect(() => {
    const browser = new BrowserSpeechEngine();
    const cloud = new CloudSpeechEngine({
      getSpeaker: () => speakerRef.current,
    });

    const player = new ReadingPlayer({
      engines: [cloud, browser],
      // No silent mid-session engine switches.
      autoFallback: false,
      listeners: {
        onSnapshot: setSnapshot,
        onHighlight: (charIndex, source) => onHighlightRef.current(charIndex, source),
      },
    });
    playerRef.current = player;

    void player.prepare();

    return () => {
      player.dispose();
      playerRef.current = null;
    };
  }, []);

  useEffect(() => {
    playerRef.current?.setText(bookText);
  }, [bookText]);

  const setSpeaker = useCallback((speaker: string) => {
    speakerRef.current = speaker;
    playerRef.current?.setSpeaker(speaker);
  }, []);

  const preferEngine = useCallback((id: EngineId) => {
    playerRef.current?.preferEngine(id);
  }, []);

  const start = useCallback((fromChar: number) => {
    playerRef.current?.start(fromChar);
  }, []);

  const pause = useCallback(() => {
    playerRef.current?.pause();
  }, []);

  const resume = useCallback(() => {
    playerRef.current?.resume();
  }, []);

  const stop = useCallback(() => {
    playerRef.current?.stop();
  }, []);

  const retry = useCallback(() => {
    playerRef.current?.retry();
  }, []);

  const useDeviceVoiceAndContinue = useCallback(() => {
    playerRef.current?.useDeviceVoiceAndContinue();
  }, []);

  const dismissNotice = useCallback(() => {
    playerRef.current?.dismissNotice();
  }, []);

  const controls = useMemo(
    () => ({
      start,
      pause,
      resume,
      stop,
      setSpeaker,
      preferEngine,
      retry,
      useDeviceVoiceAndContinue,
      dismissNotice,
      featuredSpeakers: FEATURED_SPEAKERS,
    }),
    [
      start,
      pause,
      resume,
      stop,
      setSpeaker,
      preferEngine,
      retry,
      useDeviceVoiceAndContinue,
      dismissNotice,
    ],
  );

  return {
    snapshot,
    controls,
    engine: snapshot.engine as EngineId | null,
  };
}
