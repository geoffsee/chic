import { DEFAULT_LOCALE, getCatalog, resolveLocale } from "./catalogs";
import type { Locale, MessageKey, TranslateVars } from "./types";

let activeLocale: Locale = DEFAULT_LOCALE;

export const getActiveLocale = (): Locale => activeLocale;

export const setActiveLocale = (locale: Locale) => {
  activeLocale = locale;
};

const interpolate = (template: string, vars?: TranslateVars): string => {
  if (!vars) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = vars[name];
    return value === undefined || value === null ? `{${name}}` : String(value);
  });
};

/** Translate a message key for a locale (defaults to active UI locale). */
export const t = (key: MessageKey, vars?: TranslateVars, locale?: Locale): string => {
  const resolved = locale ?? activeLocale;
  const catalog = getCatalog(resolved);
  const fallback = getCatalog(DEFAULT_LOCALE);
  const template = catalog[key] ?? fallback[key] ?? key;
  return interpolate(template, vars);
};

/** Normalize an arbitrary locale string for API requests (always a supported Locale). */
export const normalizeRequestLocale = (value: string | null | undefined): Locale =>
  resolveLocale(value);
