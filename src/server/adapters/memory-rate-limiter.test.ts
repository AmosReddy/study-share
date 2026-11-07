import { expect, test } from "vitest";
import { createMemoryRateLimiter } from "./memory-rate-limiter";

test("reports the time left in the window, rounded up to whole seconds", async () => {
  let t = 5_000;
  const limiter = createMemoryRateLimiter(() => t);
  const i = { key: "k", limit: 1, windowSeconds: 10 };
  expect(await limiter.hit(i)).toEqual({ allowed: true, retryAfterSeconds: 0 });
  t += 2_500;
  expect(await limiter.hit(i)).toEqual({ allowed: false, retryAfterSeconds: 8 });
});

test("works with the real clock when none is injected", async () => {
  const limiter = createMemoryRateLimiter();
  expect((await limiter.hit({ key: "k", limit: 1, windowSeconds: 60 })).allowed).toBe(true);
  expect((await limiter.hit({ key: "k", limit: 1, windowSeconds: 60 })).allowed).toBe(false);
});

test("forget(key) clears one key's window and leaves the others (test mode only)", async () => {
  const limiter = createMemoryRateLimiter(() => 0);
  const hit = (key: string) => limiter.hit({ key, limit: 1, windowSeconds: 60 });
  await hit("a");
  await hit("b");
  limiter.forget("a");
  expect((await hit("a")).allowed).toBe(true);
  expect((await hit("b")).allowed).toBe(false);
});
