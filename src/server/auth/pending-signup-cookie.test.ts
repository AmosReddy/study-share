import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  PENDING_SIGNUP_COOKIE,
  PENDING_SIGNUP_MAX_AGE_SECONDS,
  pendingCookieOptions,
  readPendingSignup,
  signPendingSignup,
} from "./pending-signup-cookie";

const SECRET = "test-service-role-key-not-real";
const NOW = 1_800_000_000_000;
const V = { userId: "00000000-0000-4000-8000-000000000001", email: "someone@example.invalid" };

/** The signature the module makes, computed independently (key = SHA-256 of the fixed label + secret). */
function sigFor(body: string, secret = SECRET): string {
  const key = createHash("sha256").update(`pending-signup:${secret}`).digest();
  return createHmac("sha256", key).update(body).digest("base64url");
}

/** A correctly signed value around any raw payload text, to test the checks behind a valid signature. */
function forgeRaw(text: string): string {
  const body = Buffer.from(text).toString("base64url");
  return `${body}.${sigFor(body)}`;
}

describe("pending sign-up cookie", () => {
  it("round-trips the user id and address", () => {
    const value = signPendingSignup(SECRET, V, NOW);
    expect(readPendingSignup(SECRET, value, NOW + 1000)).toEqual(V);
  });

  it("holds nothing but the id, the address and the time it was made", () => {
    const value = signPendingSignup(SECRET, V, NOW);
    const [body] = value.split(".");
    expect(JSON.parse(Buffer.from(body, "base64url").toString("utf8"))).toEqual({ ...V, iat: NOW });
    expect(value).not.toContain(SECRET);
  });

  it("refuses a tampered payload or signature", () => {
    const value = signPendingSignup(SECRET, V, NOW);
    const [body, sig] = value.split(".");
    const otherBody = Buffer.from(JSON.stringify({ ...V, userId: "someone-else", iat: NOW })).toString("base64url");
    expect(readPendingSignup(SECRET, `${otherBody}.${sig}`, NOW)).toBeNull();
    const flipFirst = (sig.startsWith("A") ? "B" : "A") + sig.slice(1);
    expect(readPendingSignup(SECRET, `${body}.${flipFirst}`, NOW)).toBeNull();
    // The last character carries 2 unused bits: a non-canonical spelling of the same bytes is refused too.
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    for (const c of alphabet) {
      if (c !== sig.at(-1)) expect(readPendingSignup(SECRET, `${body}.${sig.slice(0, -1)}${c}`, NOW)).toBeNull();
    }
    expect(readPendingSignup(SECRET, `${body}.`, NOW)).toBeNull();
    expect(readPendingSignup(SECRET, `${body}.${sig}.x`, NOW)).toBeNull();
  });

  it("refuses a value signed with another secret", () => {
    const value = signPendingSignup("another-secret", V, NOW);
    expect(readPendingSignup(SECRET, value, NOW)).toBeNull();
  });

  it("lasts 30 minutes, measured with the caller's clock", () => {
    const value = signPendingSignup(SECRET, V, NOW);
    expect(readPendingSignup(SECRET, value, NOW + 30 * 60 * 1000 - 1)).toEqual(V);
    expect(readPendingSignup(SECRET, value, NOW + 30 * 60 * 1000 + 1)).toBeNull();
    // Made in the future (a clock jump or a forgery): refused beyond a small skew.
    expect(readPendingSignup(SECRET, value, NOW - 5 * 60 * 1000)).toBeNull();
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["no dot", "abc"],
    ["not base64url", "!!!.???"],
    ["huge", "a".repeat(5000) + "." + "b".repeat(43)],
  ])("returns null for a %s value without throwing", (_label, value) => {
    expect(readPendingSignup(SECRET, value, NOW)).toBeNull();
  });

  it('derives the HMAC key as SHA-256 of "pending-signup:" + the secret (an independent signer is accepted)', () => {
    expect(readPendingSignup(SECRET, forgeRaw(JSON.stringify({ ...V, iat: NOW })), NOW)).toEqual(V);
  });

  it.each([
    ["not JSON", "not json"],
    ["an array", [1, 2]],
    ["a missing user id", { email: V.email, iat: NOW }],
    ["a non-string user id", { userId: 5, email: V.email, iat: NOW }],
    ["an empty user id", { userId: "", email: V.email, iat: NOW }],
    ["a bad email", { userId: V.userId, email: "nope", iat: NOW }],
    ["a missing time", { userId: V.userId, email: V.email }],
    ["a string time", { userId: V.userId, email: V.email, iat: String(NOW) }],
  ])("returns null for a correctly signed payload with %s", (_label, payload) => {
    const value = forgeRaw(typeof payload === "string" ? payload : JSON.stringify(payload));
    expect(readPendingSignup(SECRET, value, NOW)).toBeNull();
  });

  it("refuses an empty secret instead of signing with it", () => {
    expect(() => signPendingSignup("", V, NOW)).toThrow();
    expect(readPendingSignup("", signPendingSignup(SECRET, V, NOW), NOW)).toBeNull();
  });

  it("has httpOnly, lax, /signup-scoped options that live 30 minutes and are Secure on https", () => {
    expect(PENDING_SIGNUP_COOKIE).toBe("pending-signup");
    expect(PENDING_SIGNUP_MAX_AGE_SECONDS).toBe(1800);
    expect(pendingCookieOptions(true)).toEqual({ httpOnly: true, secure: true, sameSite: "lax", path: "/signup", maxAge: 1800 });
    expect(pendingCookieOptions(false).secure).toBe(false);
  });
});
