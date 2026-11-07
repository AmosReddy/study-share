export interface RateLimiter {
  hit(i: { key: string; limit: number; windowSeconds: number }): Promise<{ allowed: boolean; retryAfterSeconds: number }>;
}
