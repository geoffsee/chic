import { describe, expect, test } from "bun:test";
import { handleWordImage } from "../functions/api/word-image";
import { createMemoryKv } from "../src/services/memoryKv";
import type { WordHelpEnv } from "../functions/api/wordHelpShared";
import { shouldSkipImage, buildImagePrompt } from "../functions/api/wordHelpShared";

const post = (body: unknown, env: WordHelpEnv) =>
  handleWordImage(
    new Request("http://localhost/api/word-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    env,
  );

describe("word image helpers", () => {
  test("skips stopwords and tiny tokens", () => {
    expect(shouldSkipImage("the")).toBe(true);
    expect(shouldSkipImage("a")).toBe(true);
    expect(shouldSkipImage("x")).toBe(true);
    expect(shouldSkipImage("curious")).toBe(false);
  });

  test("buildImagePrompt mentions the word and avoids letters instruction", () => {
    const prompt = buildImagePrompt("rabbit", "a small mammal", "noun");
    expect(prompt).toContain("rabbit");
    expect(prompt.toLowerCase()).toContain("no text");
  });
});

describe("handleWordImage", () => {
  test("skips function words without calling AI", async () => {
    let called = false;
    const env: WordHelpEnv = {
      GUTENBERG_KV: createMemoryKv(),
      AI: {
        run: async () => {
          called = true;
          return { image: "abc" };
        },
      },
    };
    const response = await post({ word: "the" }, env);
    const body = (await response.json()) as { status: string; image: null };
    expect(body.status).toBe("skipped");
    expect(body.image).toBeNull();
    expect(called).toBe(false);
  });

  test("generates and caches an illustration", async () => {
    const kv = createMemoryKv();
    const fakeBase64 = Buffer.from("fake-jpeg").toString("base64");
    let runs = 0;
    const env: WordHelpEnv = {
      GUTENBERG_KV: kv,
      AI: {
        run: async () => {
          runs += 1;
          return { image: fakeBase64 };
        },
      },
    };

    const first = await post({ word: "rabbit", definition: "a small animal" }, env);
    const body = (await first.json()) as {
      status: string;
      image: string;
      cached: boolean;
    };
    expect(body.status).toBe("ready");
    expect(body.cached).toBe(false);
    expect(body.image.startsWith("data:image/jpeg")).toBe(true);
    expect(runs).toBe(1);

    const second = await post({ word: "rabbit" }, env);
    const cached = (await second.json()) as { status: string; cached: boolean; image: string };
    expect(cached.status).toBe("ready");
    expect(cached.cached).toBe(true);
    expect(cached.image.startsWith("data:image/jpeg")).toBe(true);
    expect(runs).toBe(1);
  });

  test("fails open when AI is unavailable", async () => {
    const env: WordHelpEnv = { GUTENBERG_KV: createMemoryKv() };
    const response = await post({ word: "rabbit" }, env);
    const body = (await response.json()) as { status: string; image: null };
    expect(response.status).toBe(200);
    expect(body.status).toBe("error");
    expect(body.image).toBeNull();
  });
});
