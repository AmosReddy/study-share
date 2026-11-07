import { describe, expect, test } from "vitest";
import type { RateLimiter } from "../ports/rate-limiter";

/**
 * Behaviour every RateLimiter must have. `make` receives a clock (milliseconds,
 * like Date.now) that the limiter must use for its windows.
 * Calling this registers tests, so call it only from a test file.
 */
export function runRateLimiterContract(make: (now: () => number) => RateLimiter) {
  describe("RateLimiter contract", () => {
    function setup() {
      let t = 1_000_000;
      return {
        limiter: make(() => t),
        advanceSeconds: (s: number) => {
          t += s * 1000;
        },
      };
    }

    test("allows hits up to the limit, then refuses the next with a retry time", async () => {
      const { limiter } = setup();
      const i = { key: "k", limit: 3, windowSeconds: 60 };
      for (let n = 0; n < 3; n++) {
        const r = await limiter.hit(i);
        expect(r.allowed).toBe(true);
      }
      const refused = await limiter.hit(i);
      expect(refused.allowed).toBe(false);
      expect(refused.retryAfterSeconds).toBeGreaterThan(0);
      expect(refused.retryAfterSeconds).toBeLessThanOrEqual(60);
    });

    test("keeps refusing for the rest of the window", async () => {
      const { limiter, advanceSeconds } = setup();
      const i = { key: "k", limit: 1, windowSeconds: 60 };
      await limiter.hit(i);
      advanceSeconds(30);
      const refused = await limiter.hit(i);
      expect(refused.allowed).toBe(false);
      expect(refused.retryAfterSeconds).toBeGreaterThan(0);
      expect(refused.retryAfterSeconds).toBeLessThanOrEqual(30);
    });

    test("counts separate keys independently", async () => {
      const { limiter } = setup();
      await limiter.hit({ key: "a", limit: 1, windowSeconds: 60 });
      expect((await limiter.hit({ key: "a", limit: 1, windowSeconds: 60 })).allowed).toBe(false);
      expect((await limiter.hit({ key: "b", limit: 1, windowSeconds: 60 })).allowed).toBe(true);
    });

    test("allows hits again once the window has passed", async () => {
      const { limiter, advanceSeconds } = setup();
      const i = { key: "k", limit: 2, windowSeconds: 60 };
      await limiter.hit(i);
      await limiter.hit(i);
      expect((await limiter.hit(i)).allowed).toBe(false);
      advanceSeconds(60);
      expect((await limiter.hit(i)).allowed).toBe(true);
      expect((await limiter.hit(i)).allowed).toBe(true);
      expect((await limiter.hit(i)).allowed).toBe(false);
    });
  });
}
