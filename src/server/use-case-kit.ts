import type { z } from "zod";
import type { RateLimiter } from "@/server/ports/rate-limiter";
import { AUTH_MESSAGES } from "@/shared/auth-messages";

/*
  Helpers shared by the use-cases (auth, groups): the result shape, form parsing and the rate
  limit checks. Wording that differs per feature is passed in; nothing here knows about a feature.
*/

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; fieldErrors?: Record<string, string>; formError?: string; retryAfterSeconds?: number };

export type Failure = Extract<ActionResult, { ok: false }>;

/** How many tries are allowed in a window. The window length is in seconds. */
export type Limit = { limit: number; windowSeconds: number };

/** One limit to count. `message` replaces the usual "too many attempts" when this one refuses. */
export type Check = { key: string; limit: Limit; message?: string };

export function parse<S extends z.ZodType>(schema: S, raw: unknown): { data: z.output<S> } | { failure: Failure } {
  const result = schema.safeParse(raw);
  if (result.success) return { data: result.data };
  const fieldErrors: Record<string, string> = {};
  let formError: string | undefined;
  for (const issue of result.error.issues) {
    const field = issue.path[0];
    if (typeof field === "string") fieldErrors[field] ??= issue.message;
    else formError ??= AUTH_MESSAGES.badForm;
  }
  return {
    failure: {
      ok: false,
      ...(Object.keys(fieldErrors).length > 0 ? { fieldErrors } : {}),
      ...(formError ? { formError } : {}),
    },
  };
}

const MAX_IP_LENGTH = 64;

/**
 * The per-IP check, or none when the address is unknown (empty). Skipping is deliberate:
 * a shared "unknown" bucket would let one visitor use up the limit for everyone.
 */
export function ipCheck(prefix: string, ip: string, limit: Limit): Check[] {
  const address = ip.trim().slice(0, MAX_IP_LENGTH);
  return address === "" ? [] : [{ key: `${prefix}:ip:${address}`, limit }];
}

/** How long one limiter hit may take before it counts as a store failure (fail open). */
const LIMITER_TIMEOUT_MS = 2000;

/** The hit (or peek), or a rejection once LIMITER_TIMEOUT_MS has passed. The timer never outlives the call. */
export async function hitWithTimeout(limiter: RateLimiter, input: Parameters<RateLimiter["hit"]>[0], op: "hit" | "peek" = "hit") {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Rate limit store timed out")), LIMITER_TIMEOUT_MS);
  });
  try {
    return await Promise.race([op === "peek" ? limiter.peek(input) : limiter.hit(input), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Counts each check and returns a failure for the first one that is over its limit; a check's own
 * `message` wins over `defaultMessage`.
 * A limiter that throws, or takes over 2 seconds, never blocks anyone: one warning is logged
 * (with no key, email, IP or error text) and that hit counts as allowed.
 */
export async function overLimit(limiter: RateLimiter, checks: Check[], defaultMessage: string): Promise<Failure | null> {
  let storeFailed = false;
  let refusal: Failure | null = null;
  for (const { key, limit, message } of checks) {
    try {
      const result = await hitWithTimeout(limiter, { key, limit: limit.limit, windowSeconds: limit.windowSeconds });
      if (!result.allowed) {
        refusal = {
          ok: false,
          formError: message ?? defaultMessage,
          retryAfterSeconds: Math.max(1, result.retryAfterSeconds),
        };
        break;
      }
    } catch {
      storeFailed = true;
    }
  }
  if (storeFailed) console.warn("Rate limit store unavailable; allowing the request.");
  return refusal;
}
