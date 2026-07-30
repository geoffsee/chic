import {
  TEXT_MODEL,
  WORD_INFO_TTL,
  capitalize,
  extractAiText,
  normalizeWord,
  primaryLocale,
  readProcessEnv,
  wordInfoCacheKey,
  type WordHelpEnv,
} from "./wordHelpShared";

type WordInfoPayload = {
  word: string;
  context?: string;
  locale?: string;
};

type CachedDefinition = {
  word: string;
  definition: string;
  example?: string;
  partOfSpeech?: string;
  source: string;
  updatedAt: number;
  /** Localized explanation for the cache key's locale */
  explanation?: string;
  locale?: string;
};

const DICTIONARY_API = "https://api.dictionaryapi.dev/api/v2/entries/en";

const buildExplanation = (payloadWord: string, entry: CachedDefinition, context?: string) => {
  const parts: string[] = [];
  const polishedWord = capitalize(payloadWord);
  if (entry.partOfSpeech) {
    parts.push(`${polishedWord} (${entry.partOfSpeech}) typically means ${entry.definition}.`);
  } else {
    parts.push(`${polishedWord} often means ${entry.definition}.`);
  }

  if (entry.example) {
    parts.push(`For example: “${entry.example}”.`);
  }

  if (context) {
    const snippet = context.length > 200 ? `${context.slice(0, 200).trim()}…` : context.trim();
    parts.push(`In this sentence: “${snippet}”.`);
  }

  parts.push(`Source: ${entry.source}.`);
  return parts.join(" ");
};

const ensurePayload = (value: unknown): value is WordInfoPayload =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as WordInfoPayload).word === "string";

const fetchDefinition = async (word: string): Promise<CachedDefinition> => {
  const response = await fetch(`${DICTIONARY_API}/${encodeURIComponent(word)}`);
  if (!response.ok) {
    throw new Error("Dictionary lookup failed.");
  }

  const payload = await response.json();
  if (!Array.isArray(payload) || payload.length === 0) {
    throw new Error("No dictionary entries found.");
  }

  const entry = payload[0];
  const meaning = Array.isArray(entry?.meanings) ? entry.meanings[0] : undefined;
  const definition = meaning?.definitions?.[0]?.definition ?? entry.word;
  const example = meaning?.definitions?.[0]?.example;
  const partOfSpeech = meaning?.partOfSpeech ?? entry?.partOfSpeech ?? undefined;

  return {
    word: entry.word ?? word,
    definition,
    example,
    partOfSpeech,
    source: "dictionaryapi.dev",
    updatedAt: Date.now(),
  };
};

const runTextModel = async (env: WordHelpEnv, prompt: string): Promise<string | null> => {
  const messages = [
    {
      role: "system",
      content:
        "You rewrite short dictionary explanations for language learners. Output only the rewritten explanation in the target language. No markdown, no preface, no quotes around the whole answer.",
    },
    { role: "user", content: prompt },
  ];

  if (env.AI) {
    try {
      const result = await env.AI.run(TEXT_MODEL, { messages });
      return extractAiText(result);
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
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${TEXT_MODEL}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ messages }),
      },
    );
    if (!response.ok) {
      return null;
    }
    const body = (await response.json()) as { result?: unknown };
    return extractAiText(body.result ?? body);
  } catch {
    return null;
  }
};

const localizeExplanation = async (
  env: WordHelpEnv,
  englishExplanation: string,
  locale: string,
  context?: string,
): Promise<{ explanation: string; localized: boolean }> => {
  if (locale === "en") {
    return { explanation: englishExplanation, localized: true };
  }

  const prompt = [
    `Target language (BCP-47 primary): ${locale}`,
    "Rewrite the following dictionary explanation into that language.",
    "Keep it short, plain, and suitable for a reading app tooltip.",
    "Preserve the meaning and any example sentence.",
    "",
    `English explanation: ${englishExplanation}`,
    context ? `Sentence context: ${context.slice(0, 200)}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const rewritten = await runTextModel(env, prompt);
  if (rewritten) {
    return { explanation: rewritten, localized: true };
  }

  return { explanation: englishExplanation, localized: false };
};

const buildResponseBody = (
  payloadWord: string,
  entry: CachedDefinition,
  explanation: string,
  locale: string,
  options: { cached: boolean; localized: boolean },
) => ({
  word: payloadWord,
  explanation,
  source: entry.source,
  definition: entry.definition,
  partOfSpeech: entry.partOfSpeech,
  locale,
  cached: options.cached,
  localized: options.localized,
});

export const handleWordInfo = async (request: Request, env: WordHelpEnv) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const payload = await request.json().catch(() => null);
  if (!ensurePayload(payload)) {
    return new Response(JSON.stringify({ error: "Provide a word to look up." }), {
      status: 400,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const trimmedWord = payload.word.trim();
  if (!trimmedWord) {
    return new Response(JSON.stringify({ error: "Provide a non-empty word." }), {
      status: 400,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const locale = primaryLocale(payload.locale);
  const key = wordInfoCacheKey(locale, trimmedWord);
  const cached = await env.GUTENBERG_KV.get(key);
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as CachedDefinition;
      const explanation =
        parsed.explanation ?? buildExplanation(trimmedWord, parsed, payload.context);
      return new Response(
        JSON.stringify(
          buildResponseBody(trimmedWord, parsed, explanation, locale, {
            cached: true,
            localized: parsed.locale ? parsed.locale === locale : locale === "en",
          }),
        ),
        { headers: { "Content-Type": "application/json; charset=utf-8" } },
      );
    } catch {
      // fall through
    }
  }

  try {
    const definition = await fetchDefinition(normalizeWord(trimmedWord) || trimmedWord);
    const englishExplanation = buildExplanation(trimmedWord, definition, payload.context);
    const { explanation, localized } = await localizeExplanation(
      env,
      englishExplanation,
      locale,
      payload.context,
    );

    const toStore: CachedDefinition = {
      ...definition,
      explanation,
      locale,
      updatedAt: Date.now(),
    };
    await env.GUTENBERG_KV.put(key, JSON.stringify(toStore), {
      expirationTtl: WORD_INFO_TTL,
    });

    return new Response(
      JSON.stringify(
        buildResponseBody(trimmedWord, definition, explanation, locale, {
          cached: false,
          localized,
        }),
      ),
      { headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to retrieve word information.";
    return new Response(JSON.stringify({ error: message }), {
      status: 502,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
};
