import { describe, expect, test } from "bun:test";
import { prepareGutenbergText } from "../src/services/gutenbergText";

const MOBY_SNIPPET = `The Project Gutenberg eBook of Moby Dick; Or, The Whale

This eBook is for the use of anyone anywhere in the United States and
most other parts of the world at no cost and with almost no restrictions
whatsoever. You may copy it, give it away or re-use it under the terms
of the Project Gutenberg License included with this eBook or online
at www.gutenberg.org. If you are not located in the United States,
you will have to check the laws of the country where you are located
before using this eBook.

Title: Moby Dick; Or, The Whale

Author: Herman Melville

Release date: July 1, 2001 [eBook #2701]
                Most recently updated: February 10, 2026

Language: English

*** START OF THE PROJECT GUTENBERG EBOOK MOBY DICK; OR, THE WHALE ***




MOBY-DICK;

or, THE WHALE.

By Herman Melville



CONTENTS

ETYMOLOGY.

EXTRACTS (Supplied by a Sub-Sub-Librarian).

CHAPTER 1. Loomings.

CHAPTER 2. The Carpet-Bag.

CHAPTER 3. The Spouter-Inn.

Epilogue




Original Transcriber’s Notes:

This text is a combination of etexts, one from the now-defunct ERIS
project at Virginia Tech and one from Project Gutenberg’s archives.



  ETYMOLOGY.


  (Supplied by a Late Consumptive Usher to a Grammar School.)

  The pale Usher—threadbare in coat, heart, body, and brain; I see him
  now. He was ever dusting his old lexicons and grammars.



  EXTRACTS. (Supplied by a Sub-Sub-Librarian).

  “And God created great whales.” —_Genesis_.

  “Leviathan maketh a path to shine after him.” —_Job_.



CHAPTER 1. Loomings.

Call me Ishmael. Some years ago—never mind how long precisely—having
little or no money in my purse, and nothing particular to interest me
on shore, I thought I would sail about a little and see the watery part
of the world.

CHAPTER 2. The Carpet-Bag.

I stuffed a shirt or two into my old carpet-bag, tucked it under my arm,
and started for Cape Horn and the Pacific.

*** END OF THE PROJECT GUTENBERG EBOOK MOBY DICK; OR, THE WHALE ***

Some leftover license text that must not be read.
`;

describe("prepareGutenbergText", () => {
  test("starts at CHAPTER 1 body, not license/TOC/etymology/extracts", () => {
    const prepared = prepareGutenbergText(MOBY_SNIPPET);

    expect(prepared.startsWith("CHAPTER 1. Loomings.")).toBe(true);
    expect(prepared).toContain("Call me Ishmael");
    expect(prepared).toContain("CHAPTER 2. The Carpet-Bag.");

    expect(prepared).not.toContain("Project Gutenberg License");
    expect(prepared).not.toContain("www.gutenberg.org");
    expect(prepared).not.toContain("Release date:");
    expect(prepared).not.toMatch(/^CONTENTS/m);
    expect(prepared).not.toContain("Original Transcriber");
    expect(prepared).not.toContain("Late Consumptive Usher");
    expect(prepared).not.toContain("And God created great whales");
    expect(prepared).not.toContain("END OF THE PROJECT GUTENBERG");
    expect(prepared).not.toContain("leftover license text");
  });

  test("with only one CHAPTER 1, still drops the PG header above it", () => {
    const raw = `
*** START OF THE PROJECT GUTENBERG EBOOK DEMO ***

Title page junk

CHAPTER 1. Beginning.

Once upon a time there was a reader.

*** END OF THE PROJECT GUTENBERG EBOOK DEMO ***
`;
    const prepared = prepareGutenbergText(raw);
    expect(prepared.startsWith("CHAPTER 1. Beginning.")).toBe(true);
    expect(prepared).toContain("Once upon a time");
    expect(prepared).not.toContain("Title page junk");
    expect(prepared).not.toContain("START OF THE PROJECT");
  });

  test("returns empty-ish input safely", () => {
    expect(prepareGutenbergText("")).toBe("");
    expect(prepareGutenbergText("   \n")).toBe("");
  });

  test("does not destroy plain text without Gutenberg markers", () => {
    const plain = "Hello sailor.\n\nThis is a short public-domain pamphlet.\n";
    expect(prepareGutenbergText(plain).trim()).toBe(plain.trim());
  });
});
