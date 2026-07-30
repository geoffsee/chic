import { GutenbergLibrary } from "./gutenberg/GutenbergLibrary";
import { LibraryRegistry } from "./registry";

/**
 * Default server-side registry with Project Gutenberg registered.
 * Add another source by implementing {@link Library} and calling `register`.
 *
 * @example
 * ```ts
 * const registry = createDefaultRegistry();
 * registry.register(new InternetArchiveLibrary());
 * ```
 */
export function createDefaultRegistry(): LibraryRegistry {
  const registry = new LibraryRegistry();
  registry.register(new GutenbergLibrary(), { default: true });
  return registry;
}

/** Shared process-local registry for Bun / Worker request handlers. */
let sharedRegistry: LibraryRegistry | null = null;

export function getSharedLibraryRegistry(): LibraryRegistry {
  if (!sharedRegistry) {
    sharedRegistry = createDefaultRegistry();
  }
  return sharedRegistry;
}

/** Test helper — drop the process-local singleton. */
export function resetSharedLibraryRegistry(): void {
  sharedRegistry = null;
}
