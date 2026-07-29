/**
 * Strip Project Gutenberg wrappers and common front matter so readers
 * (and TTS) start at the actual work — not the license, TOC, or extracts.
 */

const START_MARKER = /\*{3}\s*START OF (?:THE )?PROJECT GUTENBERG EBOOK[^\n*]*\*{3}/i;
const END_MARKER = /\*{3}\s*END OF (?:THE )?PROJECT GUTENBERG EBOOK[^\n*]*(?:\*{3})?/i;

/** First chapter of a work (TOC usually lists this earlier as well). */
const CHAPTER_ONE_LINE = /^[ \t]*(?:CHAPTER|Chapter)\s+(?:1|I)(?:\.|\b)[^\n]*$/gm;

/**
 * Prepare raw Gutenberg plain text for reading aloud / display.
 * Pure function — safe to unit test and share across client/server fetch paths.
 */
export function prepareGutenbergText(raw: string): string {
  if (!raw) {
    return "";
  }

  let text = raw.replace(/^\uFEFF/, "");

  const start = text.match(START_MARKER);
  if (start?.index != null) {
    text = text.slice(start.index + start[0].length);
  } else {
    text = stripLooseHeader(text);
  }

  const endIndex = text.search(END_MARKER);
  if (endIndex >= 0) {
    text = text.slice(0, endIndex);
  }

  text = skipToMainContent(text);
  text = text.replace(/^\s+/, "").replace(/\s+$/, "\n");
  return text;
}

/**
 * When the START marker is missing, drop the standard license preamble
 * that ends once Title/Author metadata appears, then drop that block too.
 */
function stripLooseHeader(text: string): string {
  // Common PG plain-text preamble mentions the license before the work.
  const license = text.search(/This eBook is for the use of anyone anywhere/i);
  if (license < 0 || license > 2000) {
    return text;
  }

  // Prefer cutting at the first blank-line-separated body after metadata.
  const afterMeta = text.search(
    /\n[ \t]*\n[ \t]*\n(?!\s*(?:Title|Author|Release|Language|Credits|Other information):)/,
  );
  if (afterMeta >= 0 && afterMeta < text.length / 3) {
    return text.slice(afterMeta);
  }
  return text;
}

/**
 * Jump past title page, CONTENTS, transcriber notes, ETYMOLOGY, EXTRACTS, etc.
 *
 * Strategy: if "CHAPTER 1" / "CHAPTER I" appears more than once (TOC + body),
 * start at the last occurrence. Otherwise try other body anchors, else keep text.
 */
function skipToMainContent(text: string): string {
  const chapterOneIndexes = findAllLineStarts(text, CHAPTER_ONE_LINE);
  if (chapterOneIndexes.length >= 2) {
    // TOC entry first, real chapter later — e.g. Moby-Dick.
    return text.slice(chapterOneIndexes[chapterOneIndexes.length - 1]);
  }
  if (chapterOneIndexes.length === 1) {
    // Single hit: still skip license/title above it when it sits early.
    return text.slice(chapterOneIndexes[0]);
  }

  // No chapter 1 — try other common body starts after a CONTENTS block.
  const afterContents = skipPastContents(text);
  if (afterContents !== text) {
    const refined = skipNamedFrontMatter(afterContents);
    return refined;
  }

  return skipNamedFrontMatter(text);
}

function findAllLineStarts(text: string, pattern: RegExp): number[] {
  const indexes: number[] = [];
  const re = new RegExp(
    pattern.source,
    pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`,
  );
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    indexes.push(match.index);
    if (match[0].length === 0) {
      re.lastIndex += 1;
    }
  }
  return indexes;
}

/**
 * Drop a CONTENTS listing: from a line that is only "CONTENTS" through the
 * following block of short TOC-like lines, stopping at the next major section.
 */
function skipPastContents(text: string): string {
  const contentsMatch = text.match(/^[ \t]*CONTENTS[ \t]*\.?[ \t]*$/im);
  if (!contentsMatch || contentsMatch.index == null) {
    return text;
  }

  const from = contentsMatch.index + contentsMatch[0].length;
  const rest = text.slice(from);

  // After CONTENTS, skip until a blank line followed by a non-TOC heading/prose,
  // or until ETYMOLOGY / EXTRACTS / CHAPTER / PART / BOOK / PROLOGUE.
  const resume = rest.search(
    /\n[ \t]*\n(?=[ \t]*(?:CHAPTER|Chapter|PART|Part|BOOK|Book|PROLOGUE|Prologue|ETYMOLOGY|EXTRACTS|PREFACE|Preface|INTRODUCTION|Introduction)\b)/,
  );
  if (resume >= 0) {
    return text.slice(from + resume);
  }
  return text;
}

/**
 * Skip literary front-matter sections that are not the main narrative
 * (Moby-Dick ETYMOLOGY + EXTRACTS, similar blocks in other PG books).
 */
function skipNamedFrontMatter(text: string): string {
  const sectionHeader =
    /^[ \t]*(?:Original\s+Transcriber.?s?\s+Notes?|ETYMOLOGY|EXTRACTS|ILLUSTRATIONS|LIST OF ILLUSTRATIONS|BIBLIOGRAPHY)\b[^\n]*$/gim;

  const headers = findAllLineStarts(text, sectionHeader);
  if (!headers.length) {
    return text;
  }

  // Start after the last front-matter section: find the next CHAPTER/PART/etc.
  const lastHeader = headers[headers.length - 1];
  const afterHeader = text.slice(lastHeader);
  const body = afterHeader.search(
    /\n[ \t]*(?:CHAPTER|Chapter|PART|Part|BOOK|Book|PROLOGUE|Prologue|I\.|1\.)\b/,
  );
  if (body >= 0) {
    return afterHeader.slice(body);
  }

  // If no chapter follows, drop everything up through the last front-matter
  // header's first long prose break (best-effort).
  return text;
}
