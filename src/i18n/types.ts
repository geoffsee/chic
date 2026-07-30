import type { MessageKey, Messages } from "./locales/en";

/** Supported UI locales. */
export type Locale = "en" | "ar" | "bg" | "bn" | "ca" | "cs" | "da" | "de" | "el" | "es" | "fa" | "fi" | "fr" | "he" | "hi" | "hu" | "id" | "it" | "ja" | "ko" | "ms" | "nl" | "no" | "pl" | "pt" | "ro" | "ru" | "sv" | "sw" | "th" | "tr" | "uk" | "vi" | "zh";

export type { MessageKey, Messages };

export type TranslateVars = Record<string, string | number>;

export type LocaleMeta = {
  id: Locale;
  /** Native display name for the switcher */
  name: string;
};
