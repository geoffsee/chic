/**
 * Minimal in-memory KV for local Bun dev, matching the Cloudflare KV surface
 * used by API handlers.
 */
export type MemoryKv = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
};

export function createMemoryKv(seed?: Map<string, string>): MemoryKv {
  const store = seed ?? new Map<string, string>();
  return {
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
  };
}
