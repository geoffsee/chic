import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { DEFAULT_LOCALE, LOCALE_META, SUPPORTED_LOCALES, isLocale, resolveLocale } from "./catalogs";
import { getActiveLocale, setActiveLocale, t as translate } from "./t";
import type { Locale, MessageKey, TranslateVars } from "./types";

const STORAGE_KEY = "chic.locale";

type I18nContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey, vars?: TranslateVars) => string;
  locales: typeof LOCALE_META;
};

const I18nContext = createContext<I18nContextValue | null>(null);

const readStoredLocale = (): Locale => {
  if (typeof window === "undefined") {
    return DEFAULT_LOCALE;
  }
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isLocale(stored)) {
      return stored;
    }
  } catch {
    // ignore
  }
  if (typeof navigator !== "undefined" && navigator.language) {
    return resolveLocale(navigator.language);
  }
  return DEFAULT_LOCALE;
};

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    const initial = readStoredLocale();
    setActiveLocale(initial);
    return initial;
  });

  useEffect(() => {
    setActiveLocale(locale);
    if (typeof document !== "undefined") {
      document.documentElement.lang = locale;
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      // ignore
    }
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    if (!SUPPORTED_LOCALES.includes(next)) {
      return;
    }
    setLocaleState(next);
  }, []);

  const t = useCallback(
    (key: MessageKey, vars?: TranslateVars) => translate(key, vars, locale),
    [locale],
  );

  const value = useMemo(
    () => ({
      locale,
      setLocale,
      t,
      locales: LOCALE_META,
    }),
    [locale, setLocale, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    // Safe fallback for tests / non-provider trees
    return {
      locale: getActiveLocale(),
      setLocale: setActiveLocale,
      t: (key, vars) => translate(key, vars),
      locales: LOCALE_META,
    };
  }
  return ctx;
}
