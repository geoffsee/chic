import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";
import { handleTts, AURA_SPEAKERS } from "../functions/api/tts";
import {
  DEFAULT_CLOUD_SPEAKER,
  FEATURED_SPEAKERS,
  fetchCloudTtsStatus,
  synthesizeCloudSpeech,
} from "../src/services/cloudTts";
import {
  BROWSER_SPEECH_CHUNK,
  CLOUD_SPEECH_CHUNK,
  nextSpeechChunk,
  pickPreferredVoice,
} from "../src/speech";

const originalFetch = globalThis.fetch;

describe("nextSpeechChunk", () => {
  test("returns null for empty or exhausted text", () => {
    expect(nextSpeechChunk("", 0, 100)).toBeNull();
    expect(nextSpeechChunk("   ", 0, 100)).toBeNull();
    expect(nextSpeechChunk("hello", 5, 100)).toBeNull();
  });

  test("skips leading whitespace and returns the remaining short text", () => {
    const chunk = nextSpeechChunk("   Hello world", 0, 100);
    expect(chunk).not.toBeNull();
    expect(chunk!.text).toBe("Hello world");
    expect(chunk!.start).toBe(3);
    expect(chunk!.end).toBe(14);
  });

  test("prefers sentence boundaries inside the max window", () => {
    const sentenceA = "A".repeat(50) + ". ";
    const sentenceB = "B".repeat(50) + ".";
    const text = sentenceA + sentenceB;
    const chunk = nextSpeechChunk(text, 0, 80);

    expect(chunk).not.toBeNull();
    // Should break after the first sentence, not mid-second sentence.
    expect(chunk!.text.endsWith(".")).toBe(true);
    expect(chunk!.text.includes("B")).toBe(false);
    expect(chunk!.end).toBe(sentenceA.trimEnd().length);
  });

  test("falls back to a word boundary when no sentence break is found", () => {
    const words = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");
    const chunk = nextSpeechChunk(words, 0, 80);

    expect(chunk).not.toBeNull();
    expect(chunk!.text.length).toBeLessThanOrEqual(80);
    expect(chunk!.text.endsWith(" ")).toBe(false);
    // Should not cut mid-word.
    expect(chunk!.text).toMatch(/word\d+$/);
  });

  test("covers full text when walked with cloud chunk size", () => {
    const paragraphs = Array.from(
      { length: 20 },
      (_, i) => `Paragraph ${i}. This is a complete sentence about topic ${i}.`,
    ).join(" ");

    let cursor = 0;
    let pieces = 0;
    let rebuilt = "";

    while (true) {
      const chunk = nextSpeechChunk(paragraphs, cursor, CLOUD_SPEECH_CHUNK);
      if (!chunk) {
        break;
      }
      // Include skipped leading whitespace so the walk reconstructs the source.
      rebuilt += paragraphs.slice(cursor, chunk.end);
      cursor = chunk.end;
      pieces += 1;
      expect(chunk.text.length).toBeLessThanOrEqual(CLOUD_SPEECH_CHUNK + 1);
    }

    rebuilt += paragraphs.slice(cursor);
    expect(pieces).toBeGreaterThan(1);
    expect(rebuilt).toBe(paragraphs);
  });

  test("browser chunks stay smaller than cloud chunks for the same text", () => {
    const text =
      "Once upon a time there was a long and winding sentence that goes on and on. ".repeat(10);
    const browser = nextSpeechChunk(text, 0, BROWSER_SPEECH_CHUNK);
    const cloud = nextSpeechChunk(text, 0, CLOUD_SPEECH_CHUNK);

    expect(browser).not.toBeNull();
    expect(cloud).not.toBeNull();
    expect(browser!.text.length).toBeLessThanOrEqual(BROWSER_SPEECH_CHUNK + 1);
    expect(cloud!.text.length).toBeGreaterThan(browser!.text.length);
  });
});

describe("pickPreferredVoice", () => {
  const voice = (partial: Partial<SpeechSynthesisVoice> & { name: string; lang: string }) =>
    ({
      default: false,
      localService: true,
      voiceURI: partial.name,
      ...partial,
    }) as SpeechSynthesisVoice;

  test("returns null for empty list", () => {
    expect(pickPreferredVoice([])).toBeNull();
  });

  test("prefers default English voice", () => {
    const voices = [
      voice({ name: "French", lang: "fr-FR" }),
      voice({ name: "Samantha", lang: "en-US", default: true }),
      voice({ name: "Daniel", lang: "en-GB" }),
    ];
    expect(pickPreferredVoice(voices)?.name).toBe("Samantha");
  });

  test("falls back to known English name when no default", () => {
    const voices = [
      voice({ name: "French", lang: "fr-FR" }),
      voice({ name: "Google US English", lang: "en-US" }),
    ];
    expect(pickPreferredVoice(voices)?.name).toBe("Google US English");
  });

  test("falls back to first English voice", () => {
    const voices = [
      voice({ name: "French", lang: "fr-FR" }),
      voice({ name: "English One", lang: "en-US" }),
      voice({ name: "English Two", lang: "en-GB" }),
    ];
    expect(pickPreferredVoice(voices)?.name).toBe("English One");
  });
});

describe("handleTts API", () => {
  test("GET reports unavailable when AI is not configured", async () => {
    const response = await handleTts(new Request("http://test/api/tts", { method: "GET" }), {});
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.available).toBe(false);
    expect(body.engine).toBe("none");
    expect(body.model).toBe("@cf/deepgram/aura-2-en");
    expect(body.defaultSpeaker).toBe("luna");
    expect(body.speakers).toEqual([...AURA_SPEAKERS]);
  });

  test("GET reports workers-ai when AI binding is present", async () => {
    const response = await handleTts(new Request("http://test/api/tts", { method: "GET" }), {
      AI: {
        run: async () => new Response("unused"),
      },
    });
    const body = await response.json();
    expect(body.available).toBe(true);
    expect(body.engine).toBe("workers-ai");
  });

  test("GET reports rest-api when credentials are present", async () => {
    const response = await handleTts(new Request("http://test/api/tts", { method: "GET" }), {
      CLOUDFLARE_ACCOUNT_ID: "acct",
      CLOUDFLARE_API_TOKEN: "token",
    });
    const body = await response.json();
    expect(body.available).toBe(true);
    expect(body.engine).toBe("rest-api");
  });

  test("rejects non-GET/POST methods", async () => {
    const response = await handleTts(new Request("http://test/api/tts", { method: "DELETE" }), {});
    expect(response.status).toBe(405);
  });

  test("POST validates missing/empty text", async () => {
    const missing = await handleTts(
      new Request("http://test/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
      {},
    );
    expect(missing.status).toBe(400);

    const empty = await handleTts(
      new Request("http://test/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "   " }),
      }),
      {},
    );
    expect(empty.status).toBe(400);
  });

  test("POST rejects oversized text", async () => {
    const response = await handleTts(
      new Request("http://test/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "x".repeat(1801) }),
      }),
      {
        AI: {
          run: async () => new Uint8Array([1, 2, 3]),
        },
      },
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("too long");
  });

  test("POST returns 503 when TTS is not configured", async () => {
    const response = await handleTts(
      new Request("http://test/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Hello from the book." }),
      }),
      {},
    );
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.available).toBe(false);
  });

  test("POST synthesizes via AI binding and defaults speaker to luna", async () => {
    const runs: Array<{ model: string; inputs: Record<string, unknown> }> = [];
    const audioBytes = new Uint8Array([0xff, 0xfb, 0x90, 0x00]);

    const response = await handleTts(
      new Request("http://test/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Call me Ishmael." }),
      }),
      {
        AI: {
          run: async (model, inputs) => {
            runs.push({ model, inputs });
            return audioBytes;
          },
        },
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("audio/mpeg");
    const buffer = new Uint8Array(await response.arrayBuffer());
    expect(buffer).toEqual(audioBytes);

    expect(runs).toHaveLength(1);
    expect(runs[0].model).toBe("@cf/deepgram/aura-2-en");
    expect(runs[0].inputs).toEqual({
      text: "Call me Ishmael.",
      speaker: "luna",
      encoding: "mp3",
    });
  });

  test("POST accepts a valid speaker and ignores invalid ones", async () => {
    const speakers: string[] = [];
    const env = {
      AI: {
        run: async (_model: string, inputs: Record<string, unknown>) => {
          speakers.push(String(inputs.speaker));
          return new Uint8Array([1]);
        },
      },
    };

    await handleTts(
      new Request("http://test/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Hello", speaker: "asteria" }),
      }),
      env,
    );
    await handleTts(
      new Request("http://test/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Hello", speaker: "not-a-real-voice" }),
      }),
      env,
    );

    expect(speakers).toEqual(["asteria", "luna"]);
  });

  test("POST surfaces AI binding errors as 502", async () => {
    const response = await handleTts(
      new Request("http://test/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Hello" }),
      }),
      {
        AI: {
          run: async () => {
            throw new Error("model overloaded");
          },
        },
      },
    );
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.error).toBe("model overloaded");
  });

  test("POST uses REST API when binding is absent but credentials exist", async () => {
    const audioBytes = new Uint8Array([9, 8, 7]);
    const fetchMock = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      expect(url).toContain("/ai/run/@cf/deepgram/aura-2-en");
      expect(init?.method).toBe("POST");
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer test-token");
      const body = JSON.parse(String(init?.body));
      expect(body.speaker).toBe("orion");
      return new Response(audioBytes, {
        status: 200,
        headers: { "Content-Type": "audio/mpeg" },
      });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    try {
      const response = await handleTts(
        new Request("http://test/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: "Ahoy", speaker: "orion" }),
        }),
        {
          CLOUDFLARE_ACCOUNT_ID: "acct-123",
          CLOUDFLARE_API_TOKEN: "test-token",
        },
      );

      expect(response.status).toBe(200);
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(audioBytes);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("cloudTts client", () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("FEATURED_SPEAKERS are a subset of Aura speakers", () => {
    const aura = new Set<string>(AURA_SPEAKERS);
    for (const speaker of FEATURED_SPEAKERS) {
      expect(aura.has(speaker.id)).toBe(true);
    }
    expect(DEFAULT_CLOUD_SPEAKER).toBe("luna");
  });

  test("fetchCloudTtsStatus maps a successful capability response", async () => {
    globalThis.fetch = mock(async () =>
      Response.json({
        available: true,
        model: "@cf/deepgram/aura-2-en",
        defaultSpeaker: "asteria",
        speakers: ["luna", "asteria"],
        engine: "workers-ai",
      }),
    ) as unknown as typeof fetch;

    const status = await fetchCloudTtsStatus();
    expect(status).toEqual({
      available: true,
      model: "@cf/deepgram/aura-2-en",
      defaultSpeaker: "asteria",
      speakers: ["luna", "asteria"],
      engine: "workers-ai",
    });
  });

  test("fetchCloudTtsStatus returns unavailable on network/HTTP failure", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await fetchCloudTtsStatus()).toEqual({ available: false });

    globalThis.fetch = mock(async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
    expect(await fetchCloudTtsStatus()).toEqual({ available: false });
  });

  test("synthesizeCloudSpeech returns an audio blob on success", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    globalThis.fetch = mock(async (input, init) => {
      expect(String(input)).toBe("/api/tts");
      expect(init?.method).toBe("POST");
      const body = JSON.parse(String(init?.body));
      expect(body).toEqual({ text: "Hello sea", speaker: "luna" });
      return new Response(bytes, {
        status: 200,
        headers: { "Content-Type": "audio/mpeg" },
      });
    }) as unknown as typeof fetch;

    const blob = await synthesizeCloudSpeech("Hello sea", "luna");
    expect(blob.size).toBe(4);
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
  });

  test("synthesizeCloudSpeech throws a useful error on failure", async () => {
    globalThis.fetch = mock(async () =>
      Response.json({ error: "Cloud TTS is not configured." }, { status: 503 }),
    ) as unknown as typeof fetch;

    await expect(synthesizeCloudSpeech("Hello", "luna")).rejects.toThrow(
      "Cloud TTS is not configured.",
    );
  });
});
