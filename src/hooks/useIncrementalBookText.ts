import { useCallback, useEffect, useRef, useState, type UIEvent } from "react";
import { bookRefKey, type BookSummary, type Library } from "../services/bookService";

type Options = {
  library: Library;
  selectedBook: BookSummary | null;
};

/**
 * Loads prepared book text one API page at a time and appends on demand
 * (reader scroll). Full books stay in server KV — the client never requests
 * the entire payload up front.
 */
export function useIncrementalBookText({ library, selectedBook }: Options) {
  const [bookText, setBookText] = useState("");
  const [loadingText, setLoadingText] = useState(false);
  const [loadingMoreText, setLoadingMoreText] = useState(false);
  const [textError, setTextError] = useState<string | null>(null);
  const [nextTextPage, setNextTextPage] = useState<number | null>(null);
  const [totalTextPages, setTotalTextPages] = useState(0);
  const loadMoreInFlightRef = useRef(false);
  const selectedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    selectedKeyRef.current = selectedBook ? bookRefKey(selectedBook) : null;

    if (!selectedBook) {
      setBookText("");
      setTextError(null);
      setLoadingText(false);
      setLoadingMoreText(false);
      setNextTextPage(null);
      setTotalTextPages(0);
      loadMoreInFlightRef.current = false;
      return;
    }

    let cancelled = false;
    setLoadingText(true);
    setLoadingMoreText(false);
    setTextError(null);
    setBookText("");
    setNextTextPage(null);
    setTotalTextPages(0);
    loadMoreInFlightRef.current = false;

    const selectedKey = bookRefKey(selectedBook);

    library
      .fetchBookTextPage(selectedBook, { page: 1 })
      .then((page) => {
        if (cancelled || selectedKeyRef.current !== selectedKey) {
          return;
        }
        setBookText(page.text);
        setNextTextPage(page.nextPage);
        setTotalTextPages(page.totalPages);
      })
      .catch((error) => {
        if (cancelled || selectedKeyRef.current !== selectedKey) {
          return;
        }
        setTextError(error?.message ?? "Unable to load the book text.");
        setBookText("");
        setNextTextPage(null);
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingText(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [library, selectedBook]);

  const loadMoreText = useCallback(async () => {
    if (!selectedBook || nextTextPage == null) {
      return;
    }
    if (loadingText || loadingMoreText || loadMoreInFlightRef.current) {
      return;
    }

    loadMoreInFlightRef.current = true;
    setLoadingMoreText(true);
    setTextError(null);
    const selectedKey = bookRefKey(selectedBook);
    const pageToLoad = nextTextPage;

    try {
      const page = await library.fetchBookTextPage(selectedBook, { page: pageToLoad });
      if (selectedKeyRef.current !== selectedKey) {
        return;
      }
      setBookText((previous) => previous + page.text);
      setNextTextPage(page.nextPage);
      setTotalTextPages(page.totalPages);
    } catch (error) {
      if (selectedKeyRef.current !== selectedKey) {
        return;
      }
      setTextError(error instanceof Error ? error.message : "Unable to load more of the book.");
    } finally {
      loadMoreInFlightRef.current = false;
      setLoadingMoreText(false);
    }
  }, [library, selectedBook, nextTextPage, loadingText, loadingMoreText]);

  const handleReaderScroll = useCallback(
    (event: UIEvent<HTMLElement>) => {
      const el = event.currentTarget;
      const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (remaining < 240) {
        void loadMoreText();
      }
    },
    [loadMoreText],
  );

  return {
    bookText,
    loadingText,
    loadingMoreText,
    textError,
    nextTextPage,
    totalTextPages,
    hasMoreText: nextTextPage != null,
    loadMoreText,
    handleReaderScroll,
  };
}
