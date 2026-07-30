import type { Library, LibraryId, LibraryMeta } from "./types";

/**
 * Holds registered {@link Library} plugins.
 * Resolve by id when handling catalog / text requests.
 */
export class LibraryRegistry {
  private readonly libraries = new Map<LibraryId, Library>();
  private defaultId: LibraryId | null = null;

  register(library: Library, options?: { default?: boolean }): this {
    if (this.libraries.has(library.id)) {
      throw new Error(`Library already registered: ${library.id}`);
    }
    this.libraries.set(library.id, library);
    if (options?.default || this.defaultId === null) {
      this.defaultId = library.id;
    }
    return this;
  }

  get(id: LibraryId): Library | undefined {
    return this.libraries.get(id);
  }

  /** Resolve id, or fall back to the default library when omitted / unknown. */
  require(id?: LibraryId | null): Library {
    if (id) {
      const found = this.libraries.get(id);
      if (found) {
        return found;
      }
      throw new Error(`Unknown library: ${id}`);
    }
    const fallback = this.defaultId ? this.libraries.get(this.defaultId) : undefined;
    if (!fallback) {
      throw new Error("No libraries registered.");
    }
    return fallback;
  }

  list(): Library[] {
    return Array.from(this.libraries.values());
  }

  listMeta(): LibraryMeta[] {
    return this.list().map((lib) => lib.toMeta());
  }

  get defaultLibraryId(): LibraryId | null {
    return this.defaultId;
  }
}
