import type { RateLimiter } from "../ports/rate-limiter";

/** The in-memory limiter, plus `forget` so browser tests can clear one key (test mode only). */
export type MemoryRateLimiter = RateLimiter & { forget(key: string): void };

/**
 * Fixed-window limiter held in memory. For tests and local test mode only: the
 * count is per process and is lost on restart. `now` returns milliseconds.
 */
export function createMemoryRateLimiter(now: () => number = Date.now): MemoryRateLimiter {
  const windows = new Map<string, { startedAt: number; count: number }>();

  return {
    async hit({ key, limit, windowSeconds }) {
      const t = now();
      const windowMs = windowSeconds * 1000;
      let w = windows.get(key);
      if (!w || t - w.startedAt >= windowMs) {
        w = { startedAt: t, count: 0 };
        windows.set(key, w);
      }
      if (w.count >= limit) {
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((w.startedAt + windowMs - t) / 1000)) };
      }
      w.count += 1;
      return { allowed: true, retryAfterSeconds: 0 };
    },

    async peek({ key, limit, windowSeconds }) {
      const t = now();
      const windowMs = windowSeconds * 1000;
      const w = windows.get(key);
      if (!w || t - w.startedAt >= windowMs || w.count < limit) return { allowed: true, retryAfterSeconds: 0 };
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((w.startedAt + windowMs - t) / 1000)) };
    },

    forget(key) {
      windows.delete(key);
    },
  };
}
