import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type UIEvent,
} from "react";
import {
  Badge,
  Box,
  Button,
  Flex,
  Grid,
  Heading,
  HStack,
  Input,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useIncrementalBookText } from "./hooks/useIncrementalBookText";
import { isLocale, useI18n } from "./i18n";
import {
  ApiLibrary,
  bookRefKey,
  type BookSummary,
} from "./services/bookService";
import {
  loadReadingProgress,
  saveBookPosition,
  type ReadingPosition,
} from "./services/readingProgress";
import { phaseLabel, useReadingPlayer } from "./speech";
import type { HighlightSource } from "./speech";
import "./index.css";

type TextSegment = {
  text: string;
  start: number;
  end: number;
  isWord: boolean;
};

const segmentText = (text: string): TextSegment[] => {
  const segments: TextSegment[] = [];
  const wordRegex = /\S+/g;
  let lastIndex = 0;

  for (const match of text.matchAll(wordRegex)) {
    const start = match.index ?? 0;
    const word = match[0];

    if (start > lastIndex) {
      segments.push({
        text: text.slice(lastIndex, start),
        start: lastIndex,
        end: start,
        isWord: false,
      });
    }

    const end = start + word.length;
    segments.push({ text: word, start, end, isWord: true });
    lastIndex = end;
  }

  if (lastIndex < text.length) {
    segments.push({
      text: text.slice(lastIndex),
      start: lastIndex,
      end: text.length,
      isWord: false,
    });
  }

  return segments.length ? segments : [{ text, start: 0, end: text.length, isWord: false }];
};

type InfoAnchor = {
  top: number;
  left: number;
  width: number;
  bottom: number;
};

type InfoState = {
  open: boolean;
  status: "idle" | "loading" | "ready" | "error";
  message: string;
  word: string;
  anchor: InfoAnchor | null;
  image: string | null;
  imageStatus: "idle" | "loading" | "ready" | "skipped" | "error";
  definition?: string;
  partOfSpeech?: string;
};

const findWordIndexFromChar = (wordSegments: TextSegment[], charIndex: number) => {
  if (!wordSegments.length) {
    return 0;
  }

  const lastSegment = wordSegments[wordSegments.length - 1];
  const maxIndex = Math.max(0, lastSegment.end - 1);
  const clamped = Math.max(0, Math.min(charIndex, maxIndex));

  const match = wordSegments.findIndex(
    (segment) => clamped >= segment.start && clamped < segment.end,
  );
  if (match !== -1) {
    return match;
  }

  const fallback = wordSegments.findIndex((segment) => segment.start >= clamped);
  if (fallback !== -1) {
    return fallback;
  }

  return wordSegments.length - 1;
};

const buildSentenceContext = (text: string, charIndex: number, radius = 220) => {
  if (!text) {
    return "";
  }

  const clamped = Math.max(0, Math.min(charIndex, text.length));
  const delimiters = ".!?";

  const lookBack = () => {
    const limit = Math.max(0, clamped - radius);
    for (let i = clamped - 1; i >= limit; i -= 1) {
      const char = text[i];
      if (delimiters.includes(char) || char === "\n" || char === "\r") {
        return i + 1;
      }
    }
    return limit;
  };

  const lookAhead = () => {
    const limit = Math.min(text.length, clamped + radius);
    for (let i = clamped; i < limit; i += 1) {
      const char = text[i];
      if (delimiters.includes(char) || char === "\n" || char === "\r") {
        return i + 1;
      }
    }
    return limit;
  };

  const start = lookBack();
  const end = lookAhead();
  const snippet = text.slice(start, end).trim();
  if (snippet) {
    return snippet;
  }

  return text.slice(Math.max(0, clamped - radius), Math.min(text.length, clamped + radius)).trim();
};

export function App() {
  const { t, locale, setLocale, locales } = useI18n();
  const library = useMemo(() => new ApiLibrary(), []);
  const [books, setBooks] = useState<BookSummary[]>([]);
  const [selectedBook, setSelectedBook] = useState<BookSummary | null>(null);
  const [loadingBooks, setLoadingBooks] = useState(true);
  const [loadingMoreBooks, setLoadingMoreBooks] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const {
    bookText,
    loadingText,
    loadingMoreText,
    textError,
    hasMoreText,
    loadMoreText,
    handleReaderScroll,
  } = useIncrementalBookText({ library, selectedBook });
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  /** Single query object so search resets and page advances never race. */
  const [catalogQuery, setCatalogQuery] = useState({ search: "", page: 1, nonce: 0 });
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [catalogCount, setCatalogCount] = useState(0);
  const forceCatalogReloadRef = useRef(false);
  const loadMoreInFlightRef = useRef(false);
  const bookListRef = useRef<HTMLDivElement | null>(null);
  const [sessionPositions, setSessionPositions] = useState<Record<string, ReadingPosition>>(() => {
    if (typeof window === "undefined") {
      return {};
    }
    return loadReadingProgress().positions;
  });
  const [progressWarning, setProgressWarning] = useState<string | null>(null);
  const [activeWordIndex, setActiveWordIndex] = useState(0);
  const [infoState, setInfoState] = useState<InfoState>({
    open: false,
    status: "idle",
    message: "",
    word: "",
    anchor: null,
    image: null,
    imageStatus: "idle",
  });
  const positionTimeoutRef = useRef<number | null>(null);
  const pendingWordIndexRef = useRef<number | null>(null);
  const skipAutoUpdateRef = useRef(false);
  const activeWordIndexRef = useRef(0);
  const infoAbortRef = useRef<AbortController | null>(null);
  const imageAbortRef = useRef<AbortController | null>(null);
  const wordRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const currentWordRef = useRef<HTMLSpanElement | null>(null);

  const renderedText = bookText || t("reader.fallbackText");
  const segments = useMemo(() => segmentText(renderedText), [renderedText]);
  const wordSegments = useMemo(() => segments.filter((segment) => segment.isWord), [segments]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
    }, 350);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  // Debounced search always restarts at page 1 (new query object identity).
  useEffect(() => {
    setCatalogQuery((previous) => {
      if (previous.search === debouncedSearch && previous.page === 1) {
        return previous;
      }
      return { search: debouncedSearch, page: 1, nonce: previous.nonce };
    });
  }, [debouncedSearch]);

  useEffect(() => {
    let cancelled = false;
    const { page: pageToLoad, search } = catalogQuery;
    const isFirstPage = pageToLoad === 1;

    if (isFirstPage) {
      setLoadingBooks(true);
      setLoadingMoreBooks(false);
      loadMoreInFlightRef.current = false;
    } else {
      setLoadingMoreBooks(true);
    }
    setListError(null);

    const shouldForceReload = forceCatalogReloadRef.current && isFirstPage;
    if (isFirstPage) {
      forceCatalogReloadRef.current = false;
    }

    library
      .listBooks({
        forceReload: shouldForceReload,
        page: pageToLoad,
        search,
      })
      .then((page) => {
        if (cancelled) {
          return;
        }

        const fetchedBooks = page.books ?? [];
        setCatalogCount(typeof page.count === "number" ? page.count : fetchedBooks.length);
        setNextPage(page.nextPage ?? null);

        if (isFirstPage) {
          if (fetchedBooks.length === 0) {
            setListError(
              search ? t("library.noMatch", { search }) : t("library.noneAvailable"),
            );
            setBooks([]);
            return;
          }
          setBooks(fetchedBooks);
          // Do not auto-select — user must pick a book before text loads.
          return;
        }

        setBooks((previous) => {
          const seen = new Set(previous.map((book) => bookRefKey(book)));
          const appended = fetchedBooks.filter((book) => !seen.has(bookRefKey(book)));
          return previous.concat(appended);
        });
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        if (isFirstPage) {
          setListError(error?.message ?? t("library.loadFailed"));
          setBooks([]);
          setNextPage(null);
        } else {
          setListError(error?.message ?? t("library.loadMoreFailed"));
        }
      })
      .finally(() => {
        // Always clear loading — even if this effect was cancelled — so StrictMode
        // remounts never leave the sidebar stuck on “Curating…”.
        if (isFirstPage) {
          setLoadingBooks(false);
        } else {
          setLoadingMoreBooks(false);
          loadMoreInFlightRef.current = false;
        }
      });

    return () => {
      cancelled = true;
    };
  }, [library, catalogQuery, t]);

  useEffect(() => {
    // Re-read on mount in case another tab wrote progress.
    setSessionPositions(loadReadingProgress().positions);
  }, []);

  useEffect(() => {
    return () => {
      infoAbortRef.current?.abort();
      imageAbortRef.current?.abort();
      if (positionTimeoutRef.current) {
        window.clearTimeout(positionTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    currentWordRef.current?.classList.remove("is-current");
    currentWordRef.current = null;
    wordRefs.current = [];
  }, [renderedText]);

  const highlightByWordIndex = useCallback((index: number) => {
    const el = wordRefs.current[index];
    if (!el || el === currentWordRef.current) {
      return;
    }

    currentWordRef.current?.classList.remove("is-current");
    el.classList.add("is-current");
    currentWordRef.current = el;
    el.scrollIntoView({ block: "center", inline: "nearest" });
  }, []);

  const highlightByCharIndex = useCallback(
    (charIndex: number) => {
      if (!wordSegments.length) {
        return;
      }
      const targetIndex = findWordIndexFromChar(wordSegments, charIndex);
      setActiveWordIndex((previous) => {
        if (previous === targetIndex) {
          return previous;
        }
        activeWordIndexRef.current = targetIndex;
        skipAutoUpdateRef.current = true;
        return targetIndex;
      });
    },
    [wordSegments],
  );

  const flushPositionUpdate = useCallback(
    (wordIndex: number) => {
      if (!selectedBook || !wordSegments.length) {
        return;
      }

      const progressKey = bookRefKey(selectedBook);
      const currentIndex = Math.max(0, Math.min(wordSegments.length - 1, wordIndex));
      const target = wordSegments[currentIndex];
      if (!target) {
        return;
      }

      if (positionTimeoutRef.current) {
        window.clearTimeout(positionTimeoutRef.current);
        positionTimeoutRef.current = null;
      }
      pendingWordIndexRef.current = null;

      const { store, persisted } = saveBookPosition(progressKey, {
        charIndex: target.start,
        wordIndex: currentIndex,
      });
      setSessionPositions(store.positions);
      setProgressWarning(persisted ? null : t("reader.progressSessionOnly"));
    },
    [selectedBook, t, wordSegments],
  );

  const schedulePositionUpdate = useCallback(
    (wordIndex: number) => {
      pendingWordIndexRef.current = wordIndex;
      if (positionTimeoutRef.current) {
        window.clearTimeout(positionTimeoutRef.current);
      }
      positionTimeoutRef.current = window.setTimeout(() => {
        if (pendingWordIndexRef.current !== null) {
          flushPositionUpdate(pendingWordIndexRef.current);
          pendingWordIndexRef.current = null;
        }
        positionTimeoutRef.current = null;
      }, 450);
    },
    [flushPositionUpdate],
  );

  const moveWord = useCallback(
    (direction: -1 | 1) => {
      if (!wordSegments.length) {
        return;
      }

      const current = Math.max(0, Math.min(activeWordIndex, wordSegments.length - 1));
      const next = Math.max(0, Math.min(wordSegments.length - 1, current + direction));
      if (next === current) {
        return;
      }

      skipAutoUpdateRef.current = true;
      setActiveWordIndex(next);
      flushPositionUpdate(next);
    },
    [activeWordIndex, flushPositionUpdate, wordSegments.length],
  );

  useEffect(() => {
    if (!wordSegments.length) {
      return;
    }

    const safeIndex = Math.max(0, Math.min(activeWordIndex, wordSegments.length - 1));
    if (safeIndex !== activeWordIndex) {
      setActiveWordIndex(safeIndex);
      return;
    }

    highlightByWordIndex(safeIndex);

    if (skipAutoUpdateRef.current) {
      skipAutoUpdateRef.current = false;
      return;
    }

    schedulePositionUpdate(safeIndex);
  }, [activeWordIndex, highlightByWordIndex, schedulePositionUpdate, wordSegments.length]);

  useEffect(() => {
    if (!selectedBook || !wordSegments.length) {
      setActiveWordIndex(0);
      return;
    }

    // Prefer namespaced key; fall back to bare id for pre-library progress entries.
    const saved =
      sessionPositions[bookRefKey(selectedBook)] ?? sessionPositions[selectedBook.id];
    const fromChar = typeof saved?.charIndex === "number" ? saved.charIndex : undefined;
    const preferredIndex =
      typeof saved?.wordIndex === "number"
        ? saved.wordIndex
        : typeof fromChar === "number"
          ? findWordIndexFromChar(wordSegments, fromChar)
          : 0;
    const bounded = Math.max(0, Math.min(wordSegments.length - 1, preferredIndex));

    setActiveWordIndex((previous) => (previous === bounded ? previous : bounded));
  }, [selectedBook, sessionPositions, wordSegments]);

  useEffect(() => {
    if (!infoState.open) {
      return;
    }
    const handleScroll = () => setInfoState((previous) => ({ ...previous, open: false }));
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [infoState.open]);

  useEffect(() => {
    if (!infoState.open) {
      return;
    }
    setInfoState((previous) => ({ ...previous, open: false }));
  }, [activeWordIndex, bookText, selectedBook?.id]);

  const requestWordInfo = useCallback(() => {
    const el = currentWordRef.current;
    if (!el || !wordSegments.length || !bookText.trim()) {
      return;
    }

    const word = el.textContent?.trim();
    if (!word) {
      return;
    }

    const anchorRect = el.getBoundingClientRect();
    const anchor = {
      top: anchorRect.top,
      left: anchorRect.left,
      width: anchorRect.width,
      bottom: anchorRect.bottom,
    };

    infoAbortRef.current?.abort();
    imageAbortRef.current?.abort();
    const controller = new AbortController();
    infoAbortRef.current = controller;

    setInfoState({
      open: true,
      status: "loading",
      message: "",
      word,
      anchor,
      image: null,
      imageStatus: "idle",
    });

    const charIndex = wordSegments[activeWordIndex]?.start ?? 0;
    const payload = {
      word,
      context: buildSentenceContext(bookText, charIndex),
      locale,
    };

    fetch("/api/word-info", {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(async (response) => {
        if (!response.ok) {
          const data = await response.json().catch(() => null);
          throw new Error(data?.error ?? t("wordHelp.lookupFailed"));
        }
        return response.json();
      })
      .then((body) => {
        if (controller.signal.aborted) {
          return;
        }
        const definition = typeof body?.definition === "string" ? body.definition : undefined;
        const partOfSpeech =
          typeof body?.partOfSpeech === "string" ? body.partOfSpeech : undefined;

        setInfoState({
          open: true,
          status: "ready",
          message: body?.explanation ?? t("wordHelp.noExplanation"),
          word,
          anchor,
          image: null,
          imageStatus: "loading",
          definition,
          partOfSpeech,
        });

        imageAbortRef.current?.abort();
        const imageController = new AbortController();
        imageAbortRef.current = imageController;

        fetch("/api/word-image", {
          method: "POST",
          signal: imageController.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ word, definition, partOfSpeech }),
        })
          .then(async (response) => {
            if (!response.ok) {
              return { image: null, status: "error" as const };
            }
            return response.json();
          })
          .then((imageBody) => {
            if (imageController.signal.aborted) {
              return;
            }
            const status =
              imageBody?.status === "ready" ||
              imageBody?.status === "skipped" ||
              imageBody?.status === "error"
                ? imageBody.status
                : imageBody?.image
                  ? "ready"
                  : "error";
            setInfoState((previous) =>
              previous.word === word && previous.open
                ? {
                    ...previous,
                    image: typeof imageBody?.image === "string" ? imageBody.image : null,
                    imageStatus: status,
                  }
                : previous,
            );
          })
          .catch(() => {
            if (imageController.signal.aborted) {
              return;
            }
            setInfoState((previous) =>
              previous.word === word && previous.open
                ? { ...previous, image: null, imageStatus: "error" }
                : previous,
            );
          });
      })
      .catch((error) => {
        if (controller.signal.aborted) {
          return;
        }
        setInfoState({
          open: true,
          status: "error",
          message: error instanceof Error ? error.message : t("wordHelp.loadFailed"),
          word,
          anchor,
          image: null,
          imageStatus: "error",
        });
      });
  }, [activeWordIndex, bookText, locale, t, wordSegments]);

  const handlePlayerHighlight = useCallback(
    (charIndex: number, _source: HighlightSource) => {
      // Engines own timing: browser = boundary events, cloud = audio.currentTime.
      highlightByCharIndex(charIndex);
    },
    [highlightByCharIndex],
  );

  const { snapshot: speechSnapshot, controls: speechControls } = useReadingPlayer({
    bookText,
    onHighlightChar: handlePlayerHighlight,
  });

  const isSpeaking = speechSnapshot.speaking;
  const isPaused = speechSnapshot.paused;
  const voicesReady = speechSnapshot.ready;
  const cloudTtsReady = speechSnapshot.cloudAvailable;
  const ttsStatusMessage = speechSnapshot.statusMessage;
  const ttsDetailMessage = speechSnapshot.detailMessage;
  const speechBackend = speechSnapshot.engine;
  const cloudSpeaker = speechSnapshot.speaker;
  const speechNotice = speechSnapshot.notice;

  const stopReading = useCallback(() => {
    speechControls.stop();
  }, [speechControls]);

  const pauseReading = useCallback(() => {
    speechControls.pause();
  }, [speechControls]);

  const resumeReading = useCallback(() => {
    speechControls.resume();
  }, [speechControls]);

  const startReading = useCallback(() => {
    if (!voicesReady || !bookText.trim() || !wordSegments.length) {
      return;
    }
    const startIdx = Math.max(0, Math.min(activeWordIndex, wordSegments.length - 1));
    const startChar = wordSegments[startIdx]?.start ?? 0;
    if (!bookText.slice(startChar).trim()) {
      return;
    }
    speechControls.start(startChar);
  }, [voicesReady, bookText, wordSegments, activeWordIndex, speechControls]);

  const handleStartClick = () => {
    // Error state: Play means "try again from here", not a silent no-op.
    if (speechSnapshot.phase === "error") {
      speechControls.retry();
      return;
    }
    if (isSpeaking && isPaused) {
      resumeReading();
      return;
    }
    startReading();
  };

  const handleSelectBook = (book: BookSummary) => {
    setSelectedBook(book);
  };

  const refreshCatalog = () => {
    forceCatalogReloadRef.current = true;
    setNextPage(null);
    setCatalogQuery((previous) => ({
      search: previous.search,
      page: 1,
      nonce: previous.nonce + 1,
    }));
  };

  const loadMoreBooks = useCallback(() => {
    if (loadingBooks || loadingMoreBooks || loadMoreInFlightRef.current) {
      return;
    }
    if (nextPage == null) {
      return;
    }
    loadMoreInFlightRef.current = true;
    setCatalogQuery((previous) => ({
      ...previous,
      page: nextPage,
    }));
  }, [loadingBooks, loadingMoreBooks, nextPage]);

  const handleBookListScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      const el = event.currentTarget;
      const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (remaining < 160) {
        loadMoreBooks();
      }
    },
    [loadMoreBooks],
  );

  useEffect(() => stopReading, [stopReading]);
  useEffect(() => {
    stopReading();
  }, [selectedBook, stopReading]);

  const bookReady = Boolean(bookText.trim()) && wordSegments.length > 0 && !loadingText;
  const canPlay = bookReady && voicesReady;
  const atStart = activeWordIndex <= 0;
  const atEnd = activeWordIndex >= wordSegments.length - 1;
  const isBuffering = speechSnapshot.phase === "loading" || speechSnapshot.phase === "buffering";
  const playLabel = !voicesReady
    ? t("controls.gettingReady")
    : loadingText
      ? t("controls.loadingBook")
      : isSpeaking && isPaused
        ? t("controls.resume")
        : isSpeaking
          ? phaseLabel(speechSnapshot.phase, false)
          : speechSnapshot.phase === "error"
            ? t("controls.tryAgain")
            : t("controls.play");

  // While buffering, keep Play disabled so a second click doesn’t restart by surprise.
  // While errored, Play is enabled as “Try again”.
  const playDisabled =
    speechSnapshot.phase === "error" ? false : !canPlay || (isSpeaking && !isPaused);

  const controlButtonProps = {
    size: "sm" as const,
    borderRadius: "pill",
    fontWeight: "medium",
    gap: "0.35rem",
    px: "0.95rem",
    _disabled: { opacity: 0.3, cursor: "not-allowed" },
  };

  const controlsPanel = (
    <VStack align="flex-start" gap="0.55rem">
      <HStack
        role="group"
        aria-label={t("controls.aria")}
        gap="0.65rem"
        p="0.3rem"
        borderRadius="pill"
        bg="bg.raised"
        borderWidth="1px"
        borderColor="border.subtle"
      >
        <Button
          type="button"
          {...controlButtonProps}
          onClick={handleStartClick}
          disabled={playDisabled}
          aria-busy={isBuffering || undefined}
          aria-live="polite"
          opacity={isBuffering ? 0.85 : 1}
          borderColor="accent.border"
          bg="linear-gradient(180deg, rgba(153, 136, 98, 0.25), rgba(153, 136, 98, 0.55))"
          color="ink"
          _hover={{ transform: "translateY(-1px)", borderColor: "border.soft" }}
        >
          <Box as="span" aria-hidden="true">
            {isBuffering ? "…" : "▶"}
          </Box>
          <span>{playLabel}</span>
        </Button>
        <Button
          type="button"
          {...controlButtonProps}
          variant="outline"
          onClick={pauseReading}
          disabled={!isSpeaking || isPaused || isBuffering}
          borderColor="border.soft"
          bg="bg.raised"
          color="ink"
          _hover={{ transform: "translateY(-1px)", borderColor: "border.soft" }}
        >
          <Box as="span" aria-hidden="true">
            ❚❚
          </Box>
          <span>{t("controls.pause")}</span>
        </Button>
        <Button
          type="button"
          {...controlButtonProps}
          px="0.75rem"
          onClick={() => moveWord(-1)}
          disabled={atStart || (isSpeaking && !isPaused)}
          aria-label={t("controls.prevWordAria")}
          title={isSpeaking && !isPaused ? t("controls.pauseToMove") : undefined}
          borderColor="border.strong"
          bg="rgba(255, 255, 255, 0.06)"
          color="ink"
          _hover={{ transform: "translateY(-1px)", borderColor: "border.soft" }}
        >
          <Box as="span" aria-hidden="true">
            ◀︎
          </Box>
          <span>{t("controls.word")}</span>
        </Button>
        <Button
          type="button"
          {...controlButtonProps}
          px="0.75rem"
          onClick={() => moveWord(1)}
          disabled={atEnd || (isSpeaking && !isPaused)}
          aria-label={t("controls.nextWordAria")}
          title={isSpeaking && !isPaused ? t("controls.pauseToMove") : undefined}
          borderColor="border.strong"
          bg="rgba(255, 255, 255, 0.06)"
          color="ink"
          _hover={{ transform: "translateY(-1px)", borderColor: "border.soft" }}
        >
          <Box as="span" aria-hidden="true">
            ▶︎
          </Box>
          <span>{t("controls.word")}</span>
        </Button>
      </HStack>

      {(cloudTtsReady || speechSnapshot.browserAvailable) && (
        <Flex wrap="wrap" align="center" gap="0.65rem">
          {cloudTtsReady && speechSnapshot.browserAvailable ? (
            <HStack
              role="group"
              aria-label={t("controls.voiceTypeAria")}
              p="0.2rem"
              borderRadius="pill"
              borderWidth="1px"
              borderColor="border.muted"
              bg="rgba(255, 255, 255, 0.03)"
              gap="0.15rem"
            >
              <Button
                type="button"
                size="xs"
                borderRadius="pill"
                variant="ghost"
                disabled={isSpeaking && !isPaused}
                onClick={() => speechControls.preferEngine("cloud")}
                bg={speechBackend === "cloud" ? "accent.soft" : "transparent"}
                opacity={speechBackend === "cloud" ? 1 : 0.75}
                color="ink"
                _disabled={{ opacity: 0.35, cursor: "not-allowed" }}
              >
                {t("controls.natural")}
              </Button>
              <Button
                type="button"
                size="xs"
                borderRadius="pill"
                variant="ghost"
                disabled={isSpeaking && !isPaused}
                onClick={() => speechControls.preferEngine("browser")}
                bg={speechBackend === "browser" ? "accent.soft" : "transparent"}
                opacity={speechBackend === "browser" ? 1 : 0.75}
                color="ink"
                _disabled={{ opacity: 0.35, cursor: "not-allowed" }}
              >
                {t("controls.device")}
              </Button>
            </HStack>
          ) : null}
          {cloudTtsReady && speechBackend === "cloud" ? (
            <HStack as="label" gap="0.5rem" fontSize="0.85rem" color="muted">
              <Text as="span" opacity={0.85}>
                {t("controls.speaker")}
              </Text>
              <Box
                as="select"
                value={cloudSpeaker}
                disabled={isSpeaking && !isPaused}
                onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                  speechControls.setSpeaker(event.target.value);
                }}
                appearance="none"
                borderWidth="1px"
                borderColor="border.soft"
                bg="rgba(255, 255, 255, 0.06)"
                color="ink"
                borderRadius="pill"
                px="0.9rem"
                py="0.4rem"
                font="inherit"
                cursor="pointer"
                _disabled={{ opacity: 0.45, cursor: "not-allowed" }}
              >
                {speechControls.featuredSpeakers.map((speaker) => (
                  <option key={speaker.id} value={speaker.id}>
                    {speaker.label}
                  </option>
                ))}
              </Box>
            </HStack>
          ) : null}
        </Flex>
      )}

      <VStack align="flex-start" gap="0.15rem" minH="1.1em" aria-live="polite">
        {ttsStatusMessage ? (
          <Text m="0" fontSize="0.85rem" color="muted">
            {ttsStatusMessage}
          </Text>
        ) : null}
        {ttsDetailMessage ? (
          <Text m="0" fontSize="0.8rem" color="muted" opacity={0.8}>
            {ttsDetailMessage}
          </Text>
        ) : null}
      </VStack>

      {speechNotice ? (
        <Box
          maxW="28rem"
          p="0.75rem 0.9rem"
          borderRadius="control"
          borderWidth="1px"
          borderColor={
            speechNotice.kind === "error"
              ? "rgba(153, 136, 98, 0.55)"
              : speechNotice.kind === "warning"
                ? "rgba(130, 144, 123, 0.45)"
                : "border.muted"
          }
          bg={
            speechNotice.kind === "error"
              ? "rgba(45, 48, 56, 0.75)"
              : speechNotice.kind === "warning"
                ? "rgba(107, 99, 86, 0.35)"
                : "rgba(240, 235, 227, 0.05)"
          }
          role={speechNotice.kind === "error" ? "alert" : "status"}
        >
          <Text m="0 0 0.55rem" fontSize="0.88rem" lineHeight="1.4">
            {speechNotice.message}
          </Text>
          {speechNotice.actions?.length ? (
            <Flex wrap="wrap" gap="0.4rem">
              {speechNotice.actions.includes("retry") ? (
                <Button
                  type="button"
                  size="xs"
                  borderRadius="pill"
                  borderColor="accent.border"
                  bg="accent.soft"
                  color="ink"
                  onClick={() => speechControls.retry()}
                >
                  {t("controls.tryAgain")}
                </Button>
              ) : null}
              {speechNotice.actions.includes("use-device-voice") ? (
                <Button
                  type="button"
                  size="xs"
                  borderRadius="pill"
                  borderColor="border.strong"
                  bg="rgba(255, 255, 255, 0.08)"
                  color="ink"
                  onClick={() => speechControls.useDeviceVoiceAndContinue()}
                >
                  {t("controls.useDeviceVoice")}
                </Button>
              ) : null}
              {speechNotice.actions.includes("dismiss") ? (
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  borderRadius="pill"
                  color="ink"
                  textDecoration="underline"
                  textUnderlineOffset="2px"
                  onClick={() => speechControls.dismissNotice()}
                >
                  {t("controls.dismiss")}
                </Button>
              ) : null}
            </Flex>
          ) : null}
        </Box>
      ) : null}
    </VStack>
  );

  return (
    <Box
      minH="100vh"
      w="100%"
      px={{ base: "1rem", sm: "clamp(1.2rem, 3vw, 3rem)" }}
      pt={{ base: "1rem", sm: "1.5rem" }}
      pb={{ base: "5rem", sm: "clamp(5rem, 7vw, 6rem)" }}
      display="flex"
      flexDirection="column"
      gap="1rem"
      color="ink"
    >
      <Grid
        templateColumns={{ base: "1fr", lg: "minmax(0, 1.7fr) minmax(0, 1fr)" }}
        gap="2rem"
        flex="1"
        w="100%"
      >
        <Box as="section" minH="0" display="flex" flexDirection="column" order={{ base: 2, lg: 0 }}>
          <VStack
            align="stretch"
            gap="1rem"
            bg="linear-gradient(160deg, rgba(240, 235, 227, 0.04), rgba(14, 11, 11, 0.94))"
            borderWidth="1px"
            borderColor="border.subtle"
            borderRadius="card"
            p={{ base: "1.25rem", md: "clamp(1.5rem, 2vw, 2.75rem)" }}
            boxShadow="glow"
            color="ink"
          >
            <Flex justify="space-between" gap="1.5rem" align="flex-start">
              <Box>
                <Text
                  m="0"
                  fontSize="0.85rem"
                  letterSpacing="0.2em"
                  textTransform="uppercase"
                  color="fg.accent"
                >
                  {t("reader.nowReading")}
                </Text>
                <Heading
                  as="h2"
                  fontSize={{ base: "1.75rem", md: "clamp(1.75rem, 2.6vw, 2.65rem)" }}
                  mt="0.3rem"
                  mb="0"
                  fontWeight="semibold"
                  color="ink"
                >
                  {selectedBook ? selectedBook.title : t("reader.chooseBook")}
                </Heading>
                {selectedBook && (
                  <Text m="0" fontSize="0.9rem" color="muted">
                    {selectedBook.authors.join(", ") || t("reader.unknownAuthor")} ·{" "}
                    {selectedBook.sourceLabel}
                  </Text>
                )}
              </Box>
              <Badge
                borderRadius="pill"
                px="0.75rem"
                py="0.35rem"
                bg="accent.mid"
                color="ink"
                borderWidth="1px"
                borderColor="accent.border"
                fontWeight="medium"
              >
                {library.label}
              </Badge>
            </Flex>

            {textError ? (
              <Text m="0" fontSize="0.95rem" color="fg.warning">
                {textError}
              </Text>
            ) : null}

            <Box
              minH="55vh"
              bg="linear-gradient(160deg, rgba(240, 235, 227, 0.03), rgba(9, 8, 4, 0.92))"
              borderRadius="panel"
              p="1.75rem"
              borderWidth="1px"
              borderColor="border.subtle"
              overflow="hidden"
              position="relative"
            >
              {loadingText ? (
                <Text m="0" fontSize="0.95rem" color="muted">
                  {t("reader.loadingText")}
                </Text>
              ) : (
                <Box
                  as="pre"
                  m="0"
                  whiteSpace="pre-wrap"
                  wordBreak="break-word"
                  fontSize="1rem"
                  lineHeight="1.7"
                  color="ink"
                  maxH="100%"
                  overflowY="auto"
                  fontFamily="reading"
                  onScroll={handleReaderScroll}
                >
                  {(() => {
                    let wordPointer = 0;
                    return segments.map((segment, index) => {
                      if (segment.isWord) {
                        const wordIndex = wordPointer++;
                        return (
                          <Box
                            as="span"
                            key={`${segment.start}-${segment.end}-${index}`}
                            ref={(el: HTMLSpanElement | null) => {
                              wordRefs.current[wordIndex] = el;
                            }}
                            className="word"
                          >
                            {segment.text}
                          </Box>
                        );
                      }

                      return (
                        <Box as="span" key={`${segment.start}-${segment.end}-${index}`}>
                          {segment.text}
                        </Box>
                      );
                    });
                  })()}
                  {loadingMoreText ? (
                    <Text as="span" display="block" mt="1rem" fontSize="0.9rem" color="muted">
                      {t("reader.loadingMore")}
                    </Text>
                  ) : null}
                  {!loadingMoreText && hasMoreText ? (
                    <Box as="span" display="block" mt="1rem">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => void loadMoreText()}
                        color="muted"
                        _hover={{ color: "ink" }}
                      >
                        {t("reader.loadMoreText")}
                      </Button>
                    </Box>
                  ) : null}
                </Box>
              )}
            </Box>

            <Flex
              align={{ base: "flex-start", sm: "center" }}
              justify="space-between"
              gap="1rem"
              mt="1rem"
              pt="1rem"
              borderTopWidth="1px"
              borderColor="border.subtle"
              direction={{ base: "column", sm: "row" }}
            >
              <Button
                type="button"
                {...controlButtonProps}
                onClick={requestWordInfo}
                disabled={!wordSegments.length}
                borderColor="border.soft"
                bg="accent.mid"
                color="ink"
                _hover={{ transform: "translateY(-1px)", borderColor: "border.soft" }}
              >
                <Box as="span" aria-hidden="true">
                  ℹ︎
                </Box>
                <span>{t("wordHelp.button")}</span>
              </Button>
              {progressWarning ? (
                <Text m="0" fontSize="0.85rem" color="muted" role="status">
                  {progressWarning}
                </Text>
              ) : null}
            </Flex>
          </VStack>
        </Box>

        <Box
          as="aside"
          order={{ base: 1, lg: 0 }}
          borderRadius="card"
          minH="0"
          borderWidth="1px"
          borderColor="border.subtle"
          p={{ base: "1rem", md: "1.75rem" }}
          bg="bg.panel"
          boxShadow="panel"
          display="flex"
          flexDirection="column"
          gap="1rem"
          color="ink"
        >
          <Flex align="center" justify="space-between" gap="1rem">
            <Box>
              <Text
                m="0"
                fontSize="0.85rem"
                letterSpacing="0.2em"
                textTransform="uppercase"
                color="fg.accent"
              >
                {t("library.title")}
              </Text>
              <Heading
                as="h3"
                fontSize="1.2rem"
                mt="0.2rem"
                mb="0"
                fontWeight="semibold"
                color="ink"
              >
                {t("library.subtitle")}
              </Heading>
            </Box>
            <HStack gap="0.5rem">
              <Box
                as="select"
                aria-label={t("locale.aria")}
                value={locale}
                onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                  if (isLocale(event.target.value)) {
                    setLocale(event.target.value);
                  }
                }}
                appearance="none"
                borderWidth="1px"
                borderColor="border.strong"
                bg="rgba(255, 255, 255, 0.06)"
                color="ink"
                borderRadius="control"
                px="0.65rem"
                py="0.35rem"
                font="inherit"
                fontSize="0.8rem"
                cursor="pointer"
              >
                {locales.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </Box>
              <Button
                type="button"
                size="sm"
                onClick={refreshCatalog}
                bg="rgba(255, 255, 255, 0.06)"
                borderWidth="1px"
                borderColor="border.strong"
                borderRadius="control"
                color="ink"
                _hover={{ transform: "translateY(-1px)", bg: "panel.raisedHover" }}
              >
                {t("library.refresh")}
              </Button>
            </HStack>
          </Flex>

          <Box>
            <Input
              type="search"
              value={searchInput}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                setSearchInput(event.target.value)
              }
              placeholder={t("library.searchPlaceholder")}
              aria-label={t("library.searchAria")}
              size="md"
              borderRadius="control"
              borderWidth="1px"
              borderColor="border.strong"
              bg="rgba(255, 255, 255, 0.04)"
              color="ink"
              _placeholder={{ color: "muted" }}
              _focusVisible={{
                borderColor: "fg.accent",
                outline: "none",
                boxShadow: "0 0 0 1px var(--chakra-colors-fg-accent)",
              }}
            />
            {!loadingBooks && catalogCount > 0 ? (
              <Text m="0.45rem 0 0" fontSize="0.8rem" color="muted">
                {t(catalogCount === 1 ? "library.bookCount" : "library.bookCountPlural", {
                  count: catalogCount.toLocaleString(),
                })}
                {catalogQuery.search
                  ? t("library.matching", { search: catalogQuery.search })
                  : ""}
              </Text>
            ) : null}
          </Box>

          {listError ? (
            <Text m="0" fontSize="0.95rem" color="fg.warning">
              {listError}
            </Text>
          ) : null}
          {loadingBooks ? (
            <Text m="0" fontSize="0.95rem" color="muted">
              {t("library.loading")}
            </Text>
          ) : (
            <VStack
              as="ul"
              ref={bookListRef}
              align="stretch"
              gap="0.75rem"
              m="0"
              p="0"
              listStyleType="none"
              overflowY="auto"
              maxH="70vh"
              onScroll={handleBookListScroll}
            >
              {books.map((book) => {
                const ref = bookRefKey(book);
                const active =
                  selectedBook != null && bookRefKey(selectedBook) === ref;
                return (
                  <Box
                    as="li"
                    key={ref}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleSelectBook(book)}
                    onKeyDown={(event: KeyboardEvent) => {
                      if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
                        event.preventDefault();
                        handleSelectBook(book);
                      }
                    }}
                    p="1rem 1.2rem"
                    borderRadius="20px"
                    bg={active ? "accent.mid" : "rgba(240, 235, 227, 0.03)"}
                    borderWidth="1px"
                    borderColor={active ? "fg.accent" : "transparent"}
                    cursor="pointer"
                    transition="border 0.2s ease, box-shadow 0.2s ease, background 0.2s ease"
                    color="ink"
                    _hover={{
                      borderColor: active ? "fg.accent" : "border.strong",
                      bg: active ? "accent.mid" : "rgba(240, 235, 227, 0.06)",
                      boxShadow: "cardHover",
                    }}
                  >
                    <Text fontWeight="600" mb="0.35rem" fontSize="1rem" color="ink">
                      {book.title}
                    </Text>
                    <Text m="0" fontSize="0.9rem" color="muted">
                      {book.authors.length ? book.authors.join(", ") : t("reader.unknownAuthor")}
                    </Text>
                    {book.description ? (
                      <Text m="0.35rem 0 0" fontSize="0.85rem" color="muted">
                        {book.description}
                      </Text>
                    ) : null}
                  </Box>
                );
              })}
              {loadingMoreBooks ? (
                <Text as="li" m="0" p="0.5rem 0" fontSize="0.9rem" color="muted" textAlign="center">
                  {t("library.loadingMore")}
                </Text>
              ) : null}
              {!loadingMoreBooks && nextPage != null ? (
                <Box as="li" listStyleType="none">
                  <Button
                    type="button"
                    width="100%"
                    size="sm"
                    variant="ghost"
                    onClick={loadMoreBooks}
                    color="muted"
                    _hover={{ color: "ink", bg: "rgba(255, 255, 255, 0.04)" }}
                  >
                    {t("library.loadMore")}
                  </Button>
                </Box>
              ) : null}
              {!loadingMoreBooks && nextPage == null && books.length > 0 ? (
                <Text
                  as="li"
                  m="0"
                  p="0.35rem 0"
                  fontSize="0.8rem"
                  color="muted"
                  textAlign="center"
                >
                  {t("library.endOfResults")}
                </Text>
              ) : null}
            </VStack>
          )}
        </Box>
      </Grid>

      <Box
        position="fixed"
        left="50%"
        bottom="1.25rem"
        transform="translateX(-50%)"
        zIndex="15"
        p="0.35rem 0.65rem"
        borderRadius="panel"
        backdropFilter="blur(26px)"
        bg="bg.glass"
        borderWidth="1px"
        borderColor="border.subtle"
        boxShadow="glow"
      >
        {controlsPanel}
      </Box>

      {infoState.open && infoState.anchor ? (
        <Flex
          position="fixed"
          top={`${infoState.anchor.bottom + 12}px`}
          left={`${infoState.anchor.left + infoState.anchor.width / 2}px`}
          transform="translate(-50%, 0)"
          maxW="320px"
          p="0.75rem 1rem"
          borderRadius="16px"
          borderWidth="1px"
          borderColor="border.muted"
          bg="rgba(14, 11, 11, 0.94)"
          color="ink"
          boxShadow="tooltip"
          backdropFilter="blur(16px)"
          justify="space-between"
          gap="0.75rem"
          zIndex="50"
          pointerEvents="auto"
          role="status"
          aria-live={infoState.status === "loading" ? "polite" : "assertive"}
        >
          <Box flex="1" minW="0">
            <Text as="strong" fontSize="0.95rem" letterSpacing="0.05em">
              {infoState.word}
            </Text>
            <Text m="0.25rem 0 0" fontSize="0.9rem" color="muted">
              {infoState.status === "loading" ? t("wordHelp.loading") : infoState.message}
            </Text>
            {infoState.status === "ready" && infoState.imageStatus === "loading" ? (
              <Text m="0.4rem 0 0" fontSize="0.8rem" color="muted" opacity={0.85}>
                {t("wordHelp.drawing")}
              </Text>
            ) : null}
            {infoState.image ? (
              <Box
                as="img"
                src={infoState.image}
                alt={t("wordHelp.imageAlt", { word: infoState.word })}
                mt="0.55rem"
                maxW="100%"
                w="100%"
                maxH="180px"
                objectFit="cover"
                borderRadius="12px"
                borderWidth="1px"
                borderColor="border.subtle"
              />
            ) : null}
          </Box>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            minW="auto"
            h="auto"
            p="0"
            color="muted"
            fontSize="1.3rem"
            lineHeight="1"
            aria-label={t("wordHelp.closeAria")}
            onClick={() => {
              imageAbortRef.current?.abort();
              setInfoState((previous) => ({ ...previous, open: false }));
            }}
          >
            ×
          </Button>
        </Flex>
      ) : null}
    </Box>
  );
}

export default App;
