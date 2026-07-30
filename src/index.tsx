import { serve } from "bun";
import index from "./index.html";
import { handleBookText } from "../functions/api/book-text";
import { handleBooks, handleLibraries } from "../functions/api/books";
import { handleGutenbergBooks } from "../functions/api/gutenberg-books";
import { handleTts } from "../functions/api/tts";
import { handleWordImage } from "../functions/api/word-image";
import { handleWordInfo } from "../functions/api/word-info";
import { createMemoryKv } from "./services/memoryKv";

const memoryKv = createMemoryKv();

const wordHelpEnv = () => ({
  GUTENBERG_KV: memoryKv,
  CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID,
  CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN,
});

const server = serve({
  routes: {
    "/api/libraries": {
      async GET() {
        return handleLibraries(new Request("http://localhost/api/libraries"));
      },
    },
    "/api/books": {
      async GET(req) {
        return handleBooks(req, { GUTENBERG_KV: memoryKv });
      },
    },
    /** @deprecated Prefer `/api/books?library=gutenberg` */
    "/api/gutenberg-books": {
      async GET(req) {
        return handleGutenbergBooks(req, { GUTENBERG_KV: memoryKv });
      },
    },
    "/api/book-text": {
      async POST(req) {
        return handleBookText(req, { GUTENBERG_KV: memoryKv });
      },
    },
    "/api/word-info": {
      async POST(req) {
        return handleWordInfo(req, wordHelpEnv());
      },
    },
    "/api/word-image": {
      async POST(req) {
        return handleWordImage(req, wordHelpEnv());
      },
    },
    "/api/tts": {
      async GET(req) {
        return handleTts(req, {});
      },
      async POST(req) {
        return handleTts(req, {});
      },
    },

    "/api/hello": {
      async GET(req) {
        return Response.json({
          message: "Hello, world!",
          method: "GET",
        });
      },
      async PUT(req) {
        return Response.json({
          message: "Hello, world!",
          method: "PUT",
        });
      },
    },

    "/api/hello/:name": async (req) => {
      const name = req.params.name;
      return Response.json({
        message: `Hello, ${name}!`,
      });
    },

    // Catch-all last so it never shadows /api/* handlers.
    "/*": index,
  },

  development: process.env.NODE_ENV !== "production",
  port: 4000,
});

console.log(`🚀 Server running at ${server.url}`);
