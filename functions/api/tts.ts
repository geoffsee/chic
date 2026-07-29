/**
 * Cloud TTS via Cloudflare Workers AI (Deepgram Aura-2).
 * Natural, multi-speaker English voices — far better than browser speechSynthesis.
 */

const MODEL = "@cf/deepgram/aura-2-en";
const MAX_CHARS = 1800;
const DEFAULT_SPEAKER = "luna";

/** Aura-2 English speakers (Deepgram). */
export const AURA_SPEAKERS = [
  "amalthea",
  "andromeda",
  "apollo",
  "arcas",
  "aries",
  "asteria",
  "athena",
  "atlas",
  "aurora",
  "callista",
  "cora",
  "cordelia",
  "delia",
  "draco",
  "electra",
  "harmonia",
  "helena",
  "hera",
  "hermes",
  "hyperion",
  "iris",
  "janus",
  "juno",
  "jupiter",
  "luna",
  "mars",
  "minerva",
  "neptune",
  "odysseus",
  "ophelia",
  "orion",
  "orpheus",
  "pandora",
  "phoebe",
  "pluto",
  "saturn",
  "thalia",
  "theia",
  "vesta",
  "zeus",
] as const;

export type AuraSpeaker = (typeof AURA_SPEAKERS)[number];

const SPEAKER_SET = new Set<string>(AURA_SPEAKERS);

type AiBinding = {
  run: (
    model: string,
    inputs: Record<string, unknown>,
    options?: { returnRawResponse?: boolean },
  ) => Promise<Response | ReadableStream | ArrayBuffer | Uint8Array | unknown>;
};

export type TtsEnv = {
  AI?: AiBinding;
  /** Local-dev fallback: Cloudflare REST API credentials */
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
};

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });

const isAuraSpeaker = (value: unknown): value is AuraSpeaker =>
  typeof value === "string" && SPEAKER_SET.has(value);

const audioResponse = (body: BodyInit, contentType = "audio/mpeg") =>
  new Response(body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
    },
  });

const normalizeAudioResult = async (
  result: Response | ReadableStream | ArrayBuffer | Uint8Array | unknown,
): Promise<Response> => {
  if (result instanceof Response) {
    if (!result.ok) {
      const detail = await result.text().catch(() => "");
      return json(
        { error: "TTS model request failed.", detail: detail.slice(0, 400) },
        result.status >= 400 ? result.status : 502,
      );
    }
    const type = result.headers.get("Content-Type") ?? "audio/mpeg";
    return audioResponse(result.body ?? (await result.arrayBuffer()), type);
  }

  if (result instanceof ReadableStream) {
    return audioResponse(result);
  }

  if (result instanceof ArrayBuffer) {
    return audioResponse(result);
  }

  if (result instanceof Uint8Array) {
    return audioResponse(result);
  }

  // Some runtimes wrap binary in { audio: base64 } or similar.
  if (result && typeof result === "object") {
    const record = result as Record<string, unknown>;
    if (typeof record.audio === "string") {
      const binary = Uint8Array.from(atob(record.audio), (c) => c.charCodeAt(0));
      return audioResponse(binary);
    }
  }

  return json({ error: "Unexpected TTS response shape from Workers AI." }, 502);
};

const runViaBinding = async (env: TtsEnv, text: string, speaker: string) => {
  if (!env.AI) {
    return null;
  }

  const result = await env.AI.run(
    MODEL,
    {
      text,
      speaker,
      encoding: "mp3",
    },
    { returnRawResponse: true },
  );

  return normalizeAudioResult(result);
};

const readEnv = (env: TtsEnv, key: "CLOUDFLARE_ACCOUNT_ID" | "CLOUDFLARE_API_TOKEN") => {
  const fromBinding = env[key];
  if (fromBinding) {
    return fromBinding;
  }
  try {
    // Local Bun dev only — Workers use the AI binding instead.
    return typeof process !== "undefined" ? process.env?.[key] : undefined;
  } catch {
    return undefined;
  }
};

const runViaRestApi = async (env: TtsEnv, text: string, speaker: string) => {
  const accountId = readEnv(env, "CLOUDFLARE_ACCOUNT_ID");
  const token = readEnv(env, "CLOUDFLARE_API_TOKEN");

  if (!accountId || !token) {
    return null;
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${MODEL}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      speaker,
      encoding: "mp3",
    }),
  });

  // Binary models often return raw audio; JSON errors return application/json.
  const contentType = response.headers.get("Content-Type") ?? "";
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    return json(
      { error: "Cloudflare AI REST TTS failed.", detail: detail.slice(0, 400) },
      response.status >= 400 ? response.status : 502,
    );
  }

  if (contentType.includes("application/json")) {
    const payload = (await response.json()) as {
      success?: boolean;
      result?: unknown;
      errors?: { message?: string }[];
    };
    if (payload.result) {
      return normalizeAudioResult(payload.result);
    }
    return json(
      {
        error: payload.errors?.[0]?.message ?? "Cloudflare AI returned no audio.",
      },
      502,
    );
  }

  return audioResponse(response.body ?? (await response.arrayBuffer()), contentType || "audio/mpeg");
};

export const handleTts = async (request: Request, env: TtsEnv = {}): Promise<Response> => {
  if (request.method === "GET") {
    const hasBinding = Boolean(env.AI);
    const hasRest = Boolean(readEnv(env, "CLOUDFLARE_ACCOUNT_ID") && readEnv(env, "CLOUDFLARE_API_TOKEN"));

    return json({
      available: hasBinding || hasRest,
      model: MODEL,
      defaultSpeaker: DEFAULT_SPEAKER,
      speakers: AURA_SPEAKERS,
      engine: hasBinding ? "workers-ai" : hasRest ? "rest-api" : "none",
    });
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  let payload: { text?: unknown; speaker?: unknown };
  try {
    payload = (await request.json()) as { text?: unknown; speaker?: unknown };
  } catch {
    return json({ error: "Expected JSON body with { text, speaker? }." }, 400);
  }

  const text = typeof payload.text === "string" ? payload.text.trim() : "";
  if (!text) {
    return json({ error: "Missing text to speak." }, 400);
  }
  if (text.length > MAX_CHARS) {
    return json(
      { error: `Text too long (max ${MAX_CHARS} characters per request).` },
      400,
    );
  }

  const speaker = isAuraSpeaker(payload.speaker) ? payload.speaker : DEFAULT_SPEAKER;

  try {
    const fromBinding = await runViaBinding(env, text, speaker);
    if (fromBinding) {
      return fromBinding;
    }

    const fromRest = await runViaRestApi(env, text, speaker);
    if (fromRest) {
      return fromRest;
    }

    return json(
      {
        error:
          "Cloud TTS is not configured. Bind Workers AI (AI) or set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN for local dev.",
        available: false,
      },
      503,
    );
  } catch (error) {
    return json(
      {
        error: error instanceof Error ? error.message : "Unable to synthesize speech.",
      },
      502,
    );
  }
};
