import { en, type Messages } from "./locales/en";
import { ar } from "./locales/ar";
import { bg } from "./locales/bg";
import { bn } from "./locales/bn";
import { ca } from "./locales/ca";
import { cs } from "./locales/cs";
import { da } from "./locales/da";
import { de } from "./locales/de";
import { el } from "./locales/el";
import { es } from "./locales/es";
import { fa } from "./locales/fa";
import { fi } from "./locales/fi";
import { fr } from "./locales/fr";
import { he } from "./locales/he";
import { hi } from "./locales/hi";
import { hu } from "./locales/hu";
import { id } from "./locales/id";
import { it } from "./locales/it";
import { ja } from "./locales/ja";
import { ko } from "./locales/ko";
import { ms } from "./locales/ms";
import { nl } from "./locales/nl";
import { no } from "./locales/no";
import { pl } from "./locales/pl";
import { pt } from "./locales/pt";
import { ro } from "./locales/ro";
import { ru } from "./locales/ru";
import { sv } from "./locales/sv";
import { sw } from "./locales/sw";
import { th } from "./locales/th";
import { tr } from "./locales/tr";
import { uk } from "./locales/uk";
import { vi } from "./locales/vi";
import { zh } from "./locales/zh";
import type { Locale, LocaleMeta } from "./types";

export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_META: readonly LocaleMeta[] = [
  { id: "en", name: en["locale.name"] },
  { id: "ar", name: ar["locale.name"] },
  { id: "bg", name: bg["locale.name"] },
  { id: "bn", name: bn["locale.name"] },
  { id: "ca", name: ca["locale.name"] },
  { id: "cs", name: cs["locale.name"] },
  { id: "da", name: da["locale.name"] },
  { id: "de", name: de["locale.name"] },
  { id: "el", name: el["locale.name"] },
  { id: "es", name: es["locale.name"] },
  { id: "fa", name: fa["locale.name"] },
  { id: "fi", name: fi["locale.name"] },
  { id: "fr", name: fr["locale.name"] },
  { id: "he", name: he["locale.name"] },
  { id: "hi", name: hi["locale.name"] },
  { id: "hu", name: hu["locale.name"] },
  { id: "id", name: id["locale.name"] },
  { id: "it", name: it["locale.name"] },
  { id: "ja", name: ja["locale.name"] },
  { id: "ko", name: ko["locale.name"] },
  { id: "ms", name: ms["locale.name"] },
  { id: "nl", name: nl["locale.name"] },
  { id: "no", name: no["locale.name"] },
  { id: "pl", name: pl["locale.name"] },
  { id: "pt", name: pt["locale.name"] },
  { id: "ro", name: ro["locale.name"] },
  { id: "ru", name: ru["locale.name"] },
  { id: "sv", name: sv["locale.name"] },
  { id: "sw", name: sw["locale.name"] },
  { id: "th", name: th["locale.name"] },
  { id: "tr", name: tr["locale.name"] },
  { id: "uk", name: uk["locale.name"] },
  { id: "vi", name: vi["locale.name"] },
  { id: "zh", name: zh["locale.name"] },
];

export const SUPPORTED_LOCALES: readonly Locale[] = LOCALE_META.map((entry) => entry.id);

const catalogs: Record<Locale, Messages> = {
  en,
  ar,
  bg,
  bn,
  ca,
  cs,
  da,
  de,
  el,
  es,
  fa,
  fi,
  fr,
  he,
  hi,
  hu,
  id,
  it,
  ja,
  ko,
  ms,
  nl,
  no,
  pl,
  pt,
  ro,
  ru,
  sv,
  sw,
  th,
  tr,
  uk,
  vi,
  zh,
};

export const getCatalog = (locale: Locale): Messages => catalogs[locale] ?? catalogs.en;

export const isLocale = (value: unknown): value is Locale =>
  typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);

/** Resolve a BCP-47 tag (or primary subtag) to a supported locale, else default. */
export const resolveLocale = (value: string | null | undefined): Locale => {
  if (!value) {
    return DEFAULT_LOCALE;
  }
  const primary = value.trim().toLowerCase().split(/[-_]/)[0] ?? "";
  if (isLocale(primary)) {
    return primary;
  }
  // Common aliases
  if (primary === "nb" || primary === "nn") {
    return "no";
  }
  if (primary === "cmn" || primary === "yue") {
    return "zh";
  }
  if (primary === "fil") {
    return isLocale("ms") ? "ms" : DEFAULT_LOCALE;
  }
  return DEFAULT_LOCALE;
};
