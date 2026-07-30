import { describe, expect, test } from "bun:test";
import { handleWordInfo } from "../functions/api/word-info";
import { createMemoryKv } from "../src/services/memoryKv";
import type { WordHelpEnv } from "../functions/api/wordHelpShared";

const dictionaryPayload = [
  {
    word: "curious",
    meanings: [
      {
        partOfSpeech: "adjective",
        definitions: [
          {
            definition: "eager to know or learn something",
            example: "a curious child",
          },
        ],
      },
    ],
  },
];

const mockFetchDictionary = () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("dictionaryapi.dev")) {
      return new Response(JSON.stringify(dictionaryPayload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return original(input as RequestInfo);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
};

const post = (body: unknown, env: WordHelpEnv) =>
  handleWordInfo(
    new Request("http://localhost/api/word-info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    env,
  );

describe("handleWordInfo", () => {
  test("returns English explanation and caches per locale", async () => {
    const restore = mockFetchDictionary();
    const kv = createMemoryKv();
    const env: WordHelpEnv = { GUTENBERG_KV: kv };

    try {
      const first = await post({ word: "curious", locale: "en" }, env);
      expect(first.status).toBe(200);
      const body = (await first.json()) as {
        explanation: string;
        locale: string;
        cached: boolean;
        localized: boolean;
        definition: string;
      };
      expect(body.locale).toBe("en");
      expect(body.cached).toBe(false);
      expect(body.localized).toBe(true);
      expect(body.definition).toContain("eager");
      expect(body.explanation.toLowerCase()).toContain("curious");

      const second = await post({ word: "curious", locale: "en" }, env);
      const cachedBody = (await second.json()) as { cached: boolean };
      expect(cachedBody.cached).toBe(true);
    } finally {
      restore();
    }
  });

  test("rewrites non-en locale via AI and falls back when AI fails", async () => {
    const restore = mockFetchDictionary();
    const kv = createMemoryKv();

    const aiEnv: WordHelpEnv = {
      GUTENBERG_KV: kv,
      AI: {
        run: async () => ({ response: "Curioso suele significar ansioso por saber algo." }),
      },
    };

    try {
      const response = await post({ word: "curious", locale: "es" }, aiEnv);
      const body = (await response.json()) as {
        explanation: string;
        localized: boolean;
        locale: string;
      };
      expect(body.locale).toBe("es");
      expect(body.localized).toBe(true);
      expect(body.explanation).toContain("Curioso");
    } finally {
      restore();
    }

    const restore2 = mockFetchDictionary();
    const kv2 = createMemoryKv();
    const failEnv: WordHelpEnv = {
      GUTENBERG_KV: kv2,
      AI: {
        run: async () => {
          throw new Error("nope");
        },
      },
    };

    try {
      const response = await post({ word: "curious", locale: "fr" }, failEnv);
      const body = (await response.json()) as {
        explanation: string;
        localized: boolean;
      };
      expect(body.localized).toBe(false);
      expect(body.explanation.toLowerCase()).toContain("curious");
    } finally {
      restore2();
    }
  });

  test("rejects empty word", async () => {
    const env: WordHelpEnv = { GUTENBERG_KV: createMemoryKv() };
    const response = await post({ word: "  " }, env);
    expect(response.status).toBe(400);
  });
});
