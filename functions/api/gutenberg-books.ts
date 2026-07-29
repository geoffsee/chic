type KVNamespace = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
};

type GutendexBook = {
  id: number;
  title: string;
  authors: { name: string | null }[];
  formats: Record<string, string | null>;
  bookshelves?: string[];
  subjects?: string[];
};

type BookSummary = {
  id: string;
  title: string;
  authors: string[];
  sourceLabel: string;
  description?: string;
  metadata?: GutendexBook;
  textUrl?: string;
};

type Env = {
  GUTENBERG_KV: KVNamespace;
};

const GUTENDEX_ENDPOINT = "https://gutendex.com/books/";
const CATALOG_FETCH_TIMEOUT_MS = 10_000;
const TEXT_FORMAT_PRIORITY = [
  "text/plain; charset=utf-8",
  "text/plain",
  "text/plain; charset=us-ascii",
];
const CATALOG_TTL = 60 * 5; // 5 minutes
const CACHE_KEY = "catalog";

const pickTextUrl = (formats: Record<string, string | null> = {}) => {
  for (const key of TEXT_FORMAT_PRIORITY) {
    const candidate = formats[key];
    if (candidate) {
      return candidate;
    }
  }

  const fallback = Object.values(formats).find(
    (value) => typeof value === "string" && value.endsWith(".txt"),
  );
  return fallback ?? null;
};

const describeBook = (book: GutendexBook) => {
  const buckets: string[] = [];
  if (book.bookshelves?.length) {
    buckets.push(...book.bookshelves.slice(0, 2));
  }
  if (book.subjects?.length) {
    buckets.push(...(book.subjects.slice(0, 2)));
  }
  return buckets.length ? buckets.join(" · ") : undefined;
};

const toBookSummary = (book: GutendexBook): BookSummary => ({
  id: String(book.id),
  title: book.title,
  authors: book.authors
    .map((author) => author.name)
    .filter((name): name is string => Boolean(name)),
  sourceLabel: "Project Gutenberg",
  description: describeBook(book),
  metadata: book,
  textUrl: pickTextUrl(book.formats) ?? undefined,
});

const USER_AGENT = "chic/1.0 (+https://chic.geoffsee.com)";

const fetchWithHeaders = async (input: RequestInfo, init?: RequestInit) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CATALOG_FETCH_TIMEOUT_MS);
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
        ...(init?.headers ?? {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
};

const FALLBACK_BOOKS: BookSummary[] = [
  {
    id: "14838",
    title: "The Tale of Peter Rabbit",
    authors: ["Potter, Beatrix"],
    sourceLabel: "Project Gutenberg",
    description: "Animals · Short picture story",
    textUrl: "https://www.gutenberg.org/ebooks/14838.txt.utf-8",
  },
  {
    id: "14407",
    title: "The Tale of Benjamin Bunny",
    authors: ["Potter, Beatrix"],
    sourceLabel: "Project Gutenberg",
    description: "Animals · Gentle adventure",
    textUrl: "https://www.gutenberg.org/ebooks/14407.txt.utf-8",
  },
  {
    id: "14837",
    title: "The Tale of Tom Kitten",
    authors: ["Potter, Beatrix"],
    sourceLabel: "Project Gutenberg",
    description: "Kittens · Funny short story",
    textUrl: "https://www.gutenberg.org/ebooks/14837.txt.utf-8",
  },
  {
    id: "15137",
    title: "The Tale of Mrs. Tiggy-Winkle",
    authors: ["Potter, Beatrix"],
    sourceLabel: "Project Gutenberg",
    description: "Animals · Gentle fantasy",
    textUrl: "https://www.gutenberg.org/ebooks/15137.txt.utf-8",
  },
  {
    id: "14872",
    title: "The Tale of Squirrel Nutkin",
    authors: ["Potter, Beatrix"],
    sourceLabel: "Project Gutenberg",
    description: "Animals · Riddles and adventure",
    textUrl: "https://www.gutenberg.org/ebooks/14872.txt.utf-8",
  },
  {
    id: "14848",
    title: "The Story of Miss Moppet",
    authors: ["Potter, Beatrix"],
    sourceLabel: "Project Gutenberg",
    description: "Cat and mouse · Very short story",
    textUrl: "https://www.gutenberg.org/ebooks/14848.txt.utf-8",
  },
  {
    id: "18735",
    title: "The Little Red Hen",
    authors: ["Williams, Florence White"],
    sourceLabel: "Project Gutenberg",
    description: "Animals · Repetition and teamwork",
    textUrl: "https://www.gutenberg.org/ebooks/18735.txt.utf-8",
  },
  {
    id: "18155",
    title: "The Story of the Three Little Pigs",
    authors: ["Brooke, L. Leslie"],
    sourceLabel: "Project Gutenberg",
    description: "Folktale · Repetition and rhyme",
    textUrl: "https://www.gutenberg.org/ebooks/18155.txt.utf-8",
  },
  {
    id: "23322",
    title: "The Three Bears",
    authors: ["Unknown"],
    sourceLabel: "Project Gutenberg",
    description: "Fairy tale · Familiar repetition",
    textUrl: "https://www.gutenberg.org/ebooks/23322.txt.utf-8",
  },
  {
    id: "15661",
    title: "The Golden Goose Book",
    authors: ["Brooke, L. Leslie"],
    sourceLabel: "Project Gutenberg",
    description: "Nursery tales · Rhymes and pictures",
    textUrl: "https://www.gutenberg.org/ebooks/15661.txt.utf-8",
  },
  {
    id: "136",
    title: "A Child's Garden of Verses",
    authors: ["Stevenson, Robert Louis"],
    sourceLabel: "Project Gutenberg",
    description: "Poetry · Short read-aloud verses",
    textUrl: "https://www.gutenberg.org/ebooks/136.txt.utf-8",
  },
  {
    id: "11757",
    title: "The Velveteen Rabbit",
    authors: ["Williams, Margery"],
    sourceLabel: "Project Gutenberg",
    description: "Toys · Gentle read-aloud story",
    textUrl: "https://www.gutenberg.org/ebooks/11757.txt.utf-8",
  },
];

export const handleGutenbergBooks = async (request: Request, env: Env) => {
  const requestUrl = new URL(request.url);
  const forceReload = requestUrl.searchParams.get("force") === "true";

  if (!forceReload) {
    const cached = await env.GUTENBERG_KV.get(CACHE_KEY);
    if (cached) {
      return new Response(cached, {
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }
  }

  const endpoint = new URL(GUTENDEX_ENDPOINT);
  endpoint.searchParams.set("languages", "en");
  endpoint.searchParams.set("mime_type", "text/plain");
  endpoint.searchParams.set("sort", "downloads");

  try {
    const response = await fetchWithHeaders(endpoint.toString());
    if (!response.ok) {
      throw new Error(`Gutendex status ${response.status}`);
    }

    const payload = (await response.json()) as { results?: GutendexBook[] };
    if (!Array.isArray(payload.results) || payload.results.length === 0) {
      throw new Error("empty results");
    }

    const books: BookSummary[] = payload.results.slice(0, 12).map(toBookSummary);
    const body = JSON.stringify(books);
    await env.GUTENBERG_KV.put(CACHE_KEY, body, { expirationTtl: CATALOG_TTL });

    return new Response(body, {
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch {
    // Prefer a usable offline list over a hard 502 in the reader UI.
    const body = JSON.stringify(FALLBACK_BOOKS);
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "X-Catalog-Source": "fallback",
      },
    });
  }
};
