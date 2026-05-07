/**
 * Idempotency dedupe.
 *
 * v1 backend: in-memory Map. Lives on a warm Fluid Compute instance, lost on
 * cold start. That's acceptable for our scale — duplicate webhook deliveries
 * within a single warm instance window are the common case.
 *
 * v2 backend (later): Upstash Redis from Vercel Marketplace, gated by
 * IDEMPOTENCY_BACKEND=upstash env var. Same interface; swap implementation.
 *
 * Usage:
 *   const replay = await idempotency.check<{ contactId: string }>(key);
 *   if (replay) return cachedReplay(replay);
 *   ...do work...
 *   await idempotency.set(key, { contactId }, 24 * 3600);
 */

interface Entry {
  value: unknown;
  expiresAt: number;
}

const store = new Map<string, Entry>();

/** Cap to prevent unbounded growth on a long-lived instance. */
const MAX_ENTRIES = 10_000;

function sweepExpired(): void {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (entry.expiresAt <= now) store.delete(key);
  }
  // Hard cap: drop oldest entries if we're over.
  if (store.size > MAX_ENTRIES) {
    const overflow = store.size - MAX_ENTRIES;
    const keys = Array.from(store.keys()).slice(0, overflow);
    for (const k of keys) store.delete(k);
  }
}

export const idempotency = {
  /** Returns the cached value if present and not expired, else null. */
  check<T = unknown>(key: string): T | null {
    const entry = store.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      store.delete(key);
      return null;
    }
    return entry.value as T;
  },

  /** Store a value under key with TTL in seconds. */
  set(key: string, value: unknown, ttlSeconds: number): void {
    if (store.size > MAX_ENTRIES * 1.1) sweepExpired();
    store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  },

  /** Remove a key. */
  drop(key: string): void {
    store.delete(key);
  },

  /** Diagnostic. */
  size(): number {
    return store.size;
  },

  /** For tests. */
  _reset(): void {
    store.clear();
  },
};

/**
 * Compute a stable idempotency key from arbitrary parts.
 * Uses a simple deterministic hash of joined parts — not crypto-strong, but fine
 * for dedupe (collisions just mean we'd cache one extra result by accident).
 */
export function computeIdempotencyKey(parts: (string | number | undefined | null)[]): string {
  return parts
    .map((p) => (p == null ? '' : String(p)))
    .join('|')
    .toLowerCase();
}
