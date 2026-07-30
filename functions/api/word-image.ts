import {
  IMAGE_MODEL,
  WORD_IMAGE_TTL,
  buildImagePrompt,
  extractFluxImageBase64,
  normalizeWord,
  readProcessEnv,
  shouldSkipImage,
  toDataUri,
  wordImageCacheKey,
  type WordHelpEnv,
} from "./wordHelpShared";

type WordImagePayload = {
  word: string;
  definition?: string;
  partOfSpeech?: string;
};

const ensurePayload = (value: unknown): value is WordImagePayload =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as WordImagePayload).word === "string";

const runImageModel = async (env: WordHelpEnv, prompt: string): Promise<string | null> => {
  const inputs = {
    prompt,
    steps: 4,
  };

  if (env.AI) {
    try {
      const result = await env.AI.run(IMAGE_MODEL, inputs);
      const base64 = extractFluxImageBase64(result);
      return base64 ? toDataUri(base64) : null;
    } catch {
      return null;
    }
  }

  const accountId = env.CLOUDFLARE_ACCOUNT_ID ?? readProcessEnv("CLOUDFLARE_ACCOUNT_ID");
  const token = env.CLOUDFLARE_API_TOKEN ?? readProcessEnv("CLOUDFLARE_API_TOKEN");
  if (!accountId || !token) {
    return null;
  }

  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${IMAGE_MODEL}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(inputs),
      },
    );
    if (!response.ok) {
      return null;
    }
    const body = (await response.json()) as { result?: unknown };
    const base64 = extractFluxImageBase64(body.result ?? body);
    return base64 ? toDataUri(base64) : null;
  } catch {
    return null;
  }
};

export const handleWordImage = async (request: Request, env: WordHelpEnv) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const payload = await request.json().catch(() => null);
  if (!ensurePayload(payload)) {
    return Response.json({ error: "Provide a word to illustrate.", image: null, status: "error" }, {
      status: 400,
    });
  }

  const trimmedWord = payload.word.trim();
  if (!trimmedWord) {
    return Response.json({ error: "Provide a non-empty word.", image: null, status: "error" }, {
      status: 400,
    });
  }

  if (shouldSkipImage(trimmedWord)) {
    return Response.json({
      word: trimmedWord,
      image: null,
      status: "skipped",
      cached: false,
    });
  }

  const key = wordImageCacheKey(trimmedWord);
  const cached = await env.GUTENBERG_KV.get(key);
  if (cached) {
    return Response.json({
      word: trimmedWord,
      image: toDataUri(cached),
      status: "ready",
      cached: true,
    });
  }

  const prompt = buildImagePrompt(
    normalizeWord(trimmedWord) || trimmedWord,
    payload.definition,
    payload.partOfSpeech,
  );

  const image = await runImageModel(env, prompt);
  if (!image) {
    return Response.json({
      word: trimmedWord,
      image: null,
      status: "error",
      cached: false,
    });
  }

  // Store raw base64 (without data URI prefix) to save a few bytes; toDataUri on read.
  const raw = image.includes("base64,") ? image.split("base64,")[1] ?? image : image;
  await env.GUTENBERG_KV.put(key, raw, { expirationTtl: WORD_IMAGE_TTL });

  return Response.json({
    word: trimmedWord,
    image,
    status: "ready",
    cached: false,
  });
};
