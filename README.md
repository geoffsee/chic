# chic

<p align="center">
  <img src="screenshot.png" alt="Chic Reader screenshot" width="800" />
</p>

Read public-domain books in the browser with synced text-to-speech, word highlighting, dictionary lookups, and saved reading progress. Project Gutenberg ships as the default pluggable library source.

Live at [chic.geoffsee.com](https://chic.geoffsee.com).

## Features

- Browse books through a pluggable library API (Project Gutenberg by default; paginated, lean catalog payloads)
- Infinite-scroll library with title/author search
- Book text ingested into KV and streamed to the UI one page at a time
- Read along with word-level highlighting while audio plays
- Two speech engines:
  - **Browser** — `speechSynthesis` (works offline after the book is loaded)
  - **Cloud** — Cloudflare Workers AI / Deepgram Aura-2 (natural multi-speaker English voices)
- Tap a word for short help: Free Dictionary definition (localized via Workers AI when the UI locale is not English), then an optional AI illustration (FLUX, cached in KV)
- App chrome is internationalized (English catalog + language switcher; more locales are drop-in message files)
- Resume where you left off (progress stored in the browser)

## Stack

| Layer | Tech |
| --- | --- |
| UI | React 19, Chakra UI |
| Local server | Bun (`src/index.tsx`, port 4000) |
| Production | Cloudflare Workers + static assets |
| Catalog / text | Pluggable `Library` sources (default: Gutendex + Gutenberg plain text) |
| TTS | Workers AI `@cf/deepgram/aura-2-en` |
| Word help | Free Dictionary API + optional Llama rewrite + FLUX.1 schnell illustration |
| Cache | Cloudflare KV (`GUTENBERG_KV`) |
| i18n | Lightweight catalogs in `src/i18n/` (app chrome only; book text stays original) |

## Quick start

Requires [Bun](https://bun.sh/).

```bash
bun install
bun run dev
```

Open the URL Bun prints (default `http://localhost:4000`).

### Scripts

| Script | Description |
| --- | --- |
| `bun run dev` | Hot-reload frontend + local API |
| `bun run build` | Production browser bundle → `dist/` |
| `bun run start` | Serve the app in production mode via Bun |
| `bun run deploy` | Build and deploy with Wrangler |
| `bun test` | Run unit tests in `tests/` |

## API routes

Shared handlers live under `functions/api/` and are wired for both Bun (dev) and the Worker (`index.ts`).

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/libraries` | `GET` | List registered library plugins |
| `/api/books` | `GET` | Paginated catalog (`?library=gutenberg&page=1&search=dickens&force=true`) |
| `/api/gutenberg-books` | `GET` | Legacy alias for `/api/books?library=gutenberg` |
| `/api/book-text` | `POST` | Ingest book into KV; return one text page (`{ id, libraryId?, textUrl?, page }`) |
| `/api/tts` | `GET` / `POST` | Cloud TTS (Aura-2); requires AI binding in production |
| `/api/word-info` | `POST` | Dictionary definition (+ optional context, `locale`); AI rewrite when locale ≠ `en` |
| `/api/word-image` | `POST` | AI illustration for a word (FLUX.1 schnell); cached; fail-open if AI missing |

## Deploy

1. Copy `example.wrangler.toml` to `wrangler.toml` (or edit the existing one).
2. Set your KV namespace IDs for `GUTENBERG_KV`.
3. Keep the `[ai]` binding if you want cloud TTS.
4. Point `routes` at your domain (or enable `workers_dev`).
5. Deploy:

```bash
bun run deploy
```

Cloud TTS, word-help localization, and word illustrations need the Workers AI binding. Without it, the app still works with the browser speech engine and English dictionary text (images are skipped).

### Internationalization

- UI strings live in `src/i18n/locales/` (one file per language code).
- Language switcher is in the library header; choice persists in `localStorage` (`chic.locale`).
- **Book text is never translated.** Word-help definitions are looked up in English and rewritten into the UI locale when AI is available.
- **34 locales** ship today: `en`, `es`, `fr`, `de`, `it`, `pt`, `nl`, `pl`, `ru`, `uk`, `zh`, `ja`, `ko`, `ar`, `hi`, `tr`, `vi`, `th`, `id`, `sv`, `da`, `no`, `fi`, `cs`, `ro`, `hu`, `el`, `he`, `bn`, `sw`, `ca`, `ms`, `bg`, `fa` (aliases: `nb`/`nn` → `no`, `cmn`/`yue` → `zh`).
- To add a locale: create `src/i18n/locales/<code>.ts` (`Messages`), register it in `catalogs.ts`, and extend the `Locale` type.

## Project layout

```
src/                 React app, speech player, book services/hooks
src/i18n/            Message catalogs + I18nProvider
src/services/library/  Pluggable Library base class, registry, Gutenberg plugin, API client
src/services/        Chunked book-text helpers (ingest, chunk) + speech/TTS
functions/api/       Worker/Bun API handlers (books, text, TTS, word info/image)
index.ts             Cloudflare Worker entry (routes + assets)
tests/               Bun test suites for speech, TTS, catalog, chunked text, i18n
example.wrangler.toml  Deploy config template
```

### Adding a book source

1. Subclass `Library` in `src/services/library/` (implement `listBooks`, `fetchBookTextPage`, and for server ingest `resolveTextCandidates` + `prepareText`).
2. Register it in `createDefaultRegistry()` (or call `getSharedLibraryRegistry().register(...)` at startup).
3. Browse via `/api/books?library=<your-id>`; book text posts include `libraryId`.

Book ids are namespaced as `libraryId:localId` for reading progress and multi-source maps.

## Speech architecture

Playback is driven by `ReadingPlayer` (`src/speech/`), which chunks text and drives either:

- `BrowserSpeechEngine` — Web Speech API + boundary events for highlights
- `CloudSpeechEngine` — fetches audio from `/api/tts` and maps timing for highlights

The React hook `useReadingPlayer` connects that player to the UI in `App.tsx`.
