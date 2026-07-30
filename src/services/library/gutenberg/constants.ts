export const GUTENBERG_LIBRARY_ID = "gutenberg" as const;
export const GUTENBERG_LIBRARY_LABEL = "Project Gutenberg";

/** Trailing slash avoids a 301 that some clients mishandle. */
export const GUTENDEX_ENDPOINT = "https://gutendex.com/books/";

export const TEXT_FORMAT_PRIORITY = [
  "text/plain; charset=utf-8",
  "text/plain",
  "text/plain; charset=us-ascii",
] as const;

export const GUTENBERG_USER_AGENT = "chic/1.0 (+https://chic.geoffsee.com)";
