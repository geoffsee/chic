import { handleBookText } from "./functions/api/book-text";
import { handleBooks, handleLibraries } from "./functions/api/books";
import { handleGutenbergBooks } from "./functions/api/gutenberg-books";
import { handleWordImage } from "./functions/api/word-image";
import { handleWordInfo } from "./functions/api/word-info";
import { handleTts, type TtsEnv } from "./functions/api/tts";
import type { WordHelpEnv } from "./functions/api/wordHelpShared";

type KVNamespace = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
};

type Env = TtsEnv &
  WordHelpEnv & {
    ASSETS: {
      fetch: (request: Request) => Promise<Response>;
    };
    GUTENBERG_KV: KVNamespace;
  };

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/libraries") {
      return handleLibraries(request);
    }

    if (url.pathname === "/api/books") {
      return handleBooks(request, env);
    }

    if (url.pathname === "/api/gutenberg-books") {
      return handleGutenbergBooks(request, env);
    }

    if (url.pathname === "/api/book-text" && request.method === "POST") {
      return handleBookText(request, env);
    }

    if (url.pathname === "/api/word-info") {
      return handleWordInfo(request, env);
    }

    if (url.pathname === "/api/word-image") {
      return handleWordImage(request, env);
    }

    if (url.pathname === "/api/tts") {
      return handleTts(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};
