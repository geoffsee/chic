import { serve } from "bun";
import index from "./index.html";
import {
  ProjectGutenbergBookSource,
  type BookSummary,
} from "./services/bookService";
import { handleTts } from "../functions/api/tts";

const gutenbergSource = new ProjectGutenbergBookSource();

const server = serve({
  routes: {
    "/api/gutenberg-books": {
      async GET(req) {
        try {
          const url = new URL(req.url, "http://localhost");
          const forceReload = url.searchParams.get("force") === "true";
          const page = Number.parseInt(url.searchParams.get("page") ?? "1", 10);
          const search = url.searchParams.get("search") ?? "";
          const catalog = await gutenbergSource.listBooks({
            forceReload,
            page: Number.isFinite(page) && page > 0 ? page : 1,
            search,
          });
          return Response.json(catalog);
        } catch (error) {
          return Response.json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : "Unable to fetch the catalog.",
            },
            { status: 502 },
          );
        }
      },
    },
    "/api/book-text": {
      async POST(req) {
        try {
          const payload = (await req.json()) as BookSummary | null;
          if (!payload || !payload.id) {
            return Response.json(
              { error: "Missing book information in the request body." },
              { status: 400 },
            );
          }

          const text = await gutenbergSource.fetchBookText(payload);
          return new Response(text, {
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
        } catch (error) {
          return Response.json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : "Unable to load the book text.",
            },
            { status: 502 },
          );
        }
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
