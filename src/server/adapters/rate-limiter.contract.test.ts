import { createMemoryRateLimiter } from "./memory-rate-limiter";
import { runRateLimiterContract } from "./rate-limiter.contract";

runRateLimiterContract((now) => createMemoryRateLimiter(now));
