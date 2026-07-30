import { describe, expect, test, beforeEach } from "bun:test";
import {
  DEFAULT_LOCALE,
  getActiveLocale,
  resolveLocale,
  setActiveLocale,
  t,
} from "../src/i18n";
import { COPY, engineHelp, engineLabel, phaseLabel } from "../src/speech/copy";

describe("i18n", () => {
  beforeEach(() => {
    setActiveLocale(DEFAULT_LOCALE);
  });

  test("resolves supported primary tags and falls back to en", () => {
    expect(resolveLocale("en")).toBe("en");
    expect(resolveLocale("en-US")).toBe("en");
    expect(resolveLocale("es")).toBe("es");
    expect(resolveLocale("es-MX")).toBe("es");
    expect(resolveLocale("zh-CN")).toBe("zh");
    expect(resolveLocale("nb")).toBe("no");
    expect(resolveLocale("xx")).toBe("en");
    expect(resolveLocale(undefined)).toBe("en");
  });

  test("translates known keys", () => {
    expect(t("wordHelp.loading")).toBe("Looking up the definition…");
    expect(t("library.noMatch", { search: "dickens" })).toBe('No books match “dickens”.');
  });

  test("interpolates multiple vars", () => {
    expect(t("library.bookCountPlural", { count: "12" })).toBe("12 books");
  });

  test("setActiveLocale updates speech copy getters", () => {
    setActiveLocale("en");
    expect(getActiveLocale()).toBe("en");
    expect(COPY.preparing).toBe("Getting voices ready…");
    expect(engineLabel("cloud")).toBe("Natural voice");
    expect(engineHelp("browser")).toContain("Device voice");
    expect(phaseLabel("speaking", false)).toBe("Reading");
    expect(phaseLabel("idle", true)).toBe("Paused");
  });

  test("every registered locale has full message coverage and translates a sample key", () => {
    const { SUPPORTED_LOCALES, getCatalog, LOCALE_META } = require("../src/i18n") as typeof import("../src/i18n");
    const enKeys = Object.keys(getCatalog("en")).sort();
    expect(SUPPORTED_LOCALES.length).toBeGreaterThanOrEqual(30);
    expect(LOCALE_META.length).toBe(SUPPORTED_LOCALES.length);

    for (const locale of SUPPORTED_LOCALES) {
      const catalog = getCatalog(locale);
      expect(Object.keys(catalog).sort()).toEqual(enKeys);
      expect(catalog["locale.name"].length).toBeGreaterThan(0);
      expect(t("controls.play", undefined, locale).length).toBeGreaterThan(0);
      expect(t("library.bookCount", { count: "3" }, locale)).toContain("3");
    }

    setActiveLocale("es");
    expect(t("wordHelp.button")).toBe("Ayuda de palabra");
    setActiveLocale("ja");
    expect(t("controls.play")).toBe("再生");
  });
});
