export type RateLimitInput = { key: string; limit: number; windowSeconds: number };
export type RateLimitAnswer = { allowed: boolean; retryAfterSeconds: number };

export interface RateLimiter {
  /** Counts one try for `key` and says whether it is within `limit` for the current window. */
  hit(i: RateLimitInput): Promise<RateLimitAnswer>;
  /**
   * What `hit` would answer now, without counting this call and without opening a window. For
   * a key that only one place hits (such as the minted-recovery cooldown), so that others can
   * check it without starting a window of their own.
   */
  peek(i: RateLimitInput): Promise<RateLimitAnswer>;
}
