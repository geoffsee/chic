type KVNamespace = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
};

type Env = {
  GUTENBERG_KV: KVNamespace;
};

type WordInfoPayload = {
  word: string;
  context?: string;
};

type CachedDefinition = {
  word: string;
  definition: string;
  example?: string;
  partOfSpeech?: string;
  source: string;
  updatedAt: number;
};

const WORD_INFO_TTL = 60 * 5; // 5 minutes
const DICTIONARY_API = "https://api.dictionaryapi.dev/api/v2/entries/en";

const normalizeWord = (value: string) => value.trim().toLowerCase();

const capitalize = (value: string) =>
  value ? value.charAt(0).toUpperCase() + value.slice(1) : value;

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

const fetchDefinition = async (word: string) => {
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
  } satisfies CachedDefinition;
};

const buildResponseBody = (
  payloadWord: string,
  entry: CachedDefinition,
  context?: string,
  cached = false,
) => ({
  word: payloadWord,
  explanation: buildExplanation(payloadWord, entry, context),
  source: entry.source,
  definition: entry.definition,
  partOfSpeech: entry.partOfSpeech,
  cached,
});

export const handleWordInfo = async (request: Request, env: Env) => {
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

  const key = `word-info:${normalizeWord(trimmedWord)}`;
  const cached = await env.GUTENBERG_KV.get(key);
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as CachedDefinition;
      return new Response(
        JSON.stringify(buildResponseBody(trimmedWord, parsed, payload.context, true)),
        { headers: { "Content-Type": "application/json; charset=utf-8" } },
      );
    } catch {
      // fall through to fetch a fresh definition
    }
  }

  try {
    const definition = await fetchDefinition(trimmedWord);
    await env.GUTENBERG_KV.put(key, JSON.stringify(definition), {
      expirationTtl: WORD_INFO_TTL,
    });
    return new Response(
      JSON.stringify(buildResponseBody(trimmedWord, definition, payload.context, false)),
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
