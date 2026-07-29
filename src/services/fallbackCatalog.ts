import type { BookSummary } from "./bookService";

/**
 * Curated classics used when Gutendex is slow, down, or rate-limited.
 * IDs and plain-text URLs are stable Project Gutenberg endpoints.
 */
export const FALLBACK_CATALOG: BookSummary[] = [
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
