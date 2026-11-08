import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/*
  The "pending sign-up" cookie (spec 5.1). It remembers which pending account THIS browser
  created, so a code that confirms some other account (a stranger's later sign-up of the same
  address) is not treated as this person's sign-in. It also pre-fills the address on the code
  screen.

  It is NEVER used to authenticate anyone: it holds no secret, only the pending user's id, the
  address and when it was made, signed with HMAC-SHA-256 so it cannot be forged or edited. The
  key is derived from the existing service-role setting with a fixed label (no new setting);
  the setting itself is never put in the cookie.

  Pure functions: the caller reads and writes the cookie and passes its own clock.
*/

export const PENDING_SIGNUP_COOKIE = "pending-signup";
export const PENDING_SIGNUP_MAX_AGE_SECONDS = 30 * 60;

/**
 * The cookie's name on this site. On https it carries the `__Secure-` prefix, so the browser
 * only accepts it with the Secure flag from a secure page (a plain-http page or a sibling
 * subdomain over http cannot plant one). The prefix allows any path, so `/signup` is kept;
 * `__Host-` would require path `/`. Local http runs use the bare name (the prefix needs https).
 */
export function pendingCookieName(secure: boolean): string {
  return secure ? `__Secure-${PENDING_SIGNUP_COOKIE}` : PENDING_SIGNUP_COOKIE;
}

export type PendingSignup = { userId: string; email: string };

const MAX_AGE_MS = PENDING_SIGNUP_MAX_AGE_SECONDS * 1000;
/** A value stamped later than this ahead of the reader's clock is refused (clock skew allowance). */
const FUTURE_SKEW_MS = 60 * 1000;
/** Real values are about 200 characters; anything much longer is refused before any work. */
const MAX_VALUE_LENGTH = 1024;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

const payloadSchema = z.object({
  userId: z.string().min(1).max(128),
  email: z.email().max(320),
  iat: z.number().int().nonnegative(),
});

/** HMAC key: SHA-256 of the fixed label plus the secret. */
function hmacKey(secret: string): Buffer {
  return createHash("sha256").update(`pending-signup:${secret}`).digest();
}

function signature(secret: string, body: string): Buffer {
  return createHmac("sha256", hmacKey(secret)).update(body).digest();
}

/** The cookie value for a pending account this browser just created. `secret` is the service-role key. */
export function signPendingSignup(secret: string, v: PendingSignup, nowMs: number): string {
  if (secret === "") throw new Error("The pending sign-up cookie needs a secret.");
  const body = Buffer.from(JSON.stringify({ userId: v.userId, email: v.email, iat: nowMs })).toString("base64url");
  return `${body}.${signature(secret, body).toString("base64url")}`;
}

/**
 * The pending account in a cookie value, or null when it is missing, malformed, forged, signed
 * with another secret, older than 30 minutes or stamped in the future. Never throws.
 */
export function readPendingSignup(secret: string, value: string | undefined, nowMs: number): PendingSignup | null {
  try {
    if (secret === "" || typeof value !== "string" || value.length > MAX_VALUE_LENGTH) return null;
    const parts = value.split(".");
    if (parts.length !== 2) return null;
    const [body, sig] = parts;
    if (!BASE64URL.test(body) || !BASE64URL.test(sig)) return null;

    const expected = signature(secret, body);
    const given = Buffer.from(sig, "base64url");
    // Only the canonical spelling: the last character's unused bits must not make a second valid value.
    if (given.toString("base64url") !== sig) return null;
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

    const parsed = payloadSchema.safeParse(JSON.parse(Buffer.from(body, "base64url").toString("utf8")));
    if (!parsed.success) return null;
    const { userId, email, iat } = parsed.data;
    if (iat > nowMs + FUTURE_SKEW_MS || nowMs - iat > MAX_AGE_MS) return null;
    return { userId, email };
  } catch {
    return null;
  }
}

/**
 * Options for writing the cookie: httpOnly (no browser code reads it), sameSite lax, Secure on
 * https, only sent to the sign-up pages (`/signup` and `/signup/verify`), 30 minutes.
 * `secure` is siteUsesHttps() from the auth cookie options.
 */
export function pendingCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/signup",
    maxAge: PENDING_SIGNUP_MAX_AGE_SECONDS,
  };
}
