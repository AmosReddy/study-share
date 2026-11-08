import "server-only";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { z } from "zod";
import { siteUsesHttps } from "@/server/adapters/supabase-auth-cookies";
import { getServerEnv } from "@/server/env";
import { getRateLimiter } from "@/server/services";
import {
  PENDING_SIGNUP_MAX_AGE_SECONDS,
  pendingCookieName,
  pendingCookieOptions,
  readPendingSignup,
  signPendingSignup,
  type PendingSignup,
} from "./pending-signup-cookie";
import { secondsUntilEmailAllowed } from "./use-cases";

/*
  Reading and writing the sign-up cookies for the server actions and the code screen.

  - The signed pending sign-up cookie (see pending-signup-cookie.ts): set after a sign-up, read
    by the code screen and its actions, cleared once the code is accepted or the person changes
    the address. It is never used to sign anyone in.
  - A plain "address to fill in" cookie, set only by the log-in page's "send a new code" button
    (that page cannot prove which pending account the person owns, so it cannot set the signed
    cookie). It only pre-fills the address field on the code screen and decides nothing.

  Both are httpOnly and only sent to /signup pages. Cookies are always read before the
  settings, so a build without secrets never reaches getServerEnv().
*/

const SIGNUP_EMAIL_COOKIE = "signup-email";
const prefillSchema = z.email().max(320);

const prefixed = (name: string, secure: boolean) => (secure ? `__Secure-${name}` : name);

/** The pending sign-up this browser created, or null (missing, forged, expired or unreadable). */
export async function readPendingSignupCookie(): Promise<PendingSignup | null> {
  const store = await cookies();
  const value = store.get(pendingCookieName(siteUsesHttps()))?.value;
  if (!value) return null;
  return readPendingSignup(getServerEnv().SUPABASE_SERVICE_ROLE_KEY, value, Date.now());
}

/** Remembers the pending account a sign-up just created. Server actions only. */
export async function writePendingSignupCookie(pending: PendingSignup): Promise<void> {
  const store = await cookies();
  const secure = siteUsesHttps();
  const value = signPendingSignup(getServerEnv().SUPABASE_SERVICE_ROLE_KEY, pending, Date.now());
  store.set(pendingCookieName(secure), value, pendingCookieOptions(secure));
  store.set(prefixed(SIGNUP_EMAIL_COOKIE, secure), "", { ...pendingCookieOptions(secure), maxAge: 0 });
}

/** Pre-fills the code screen's address field (log-in page only). Server actions only. */
export async function writeSignupEmailCookie(email: string): Promise<void> {
  const store = await cookies();
  const secure = siteUsesHttps();
  store.set(prefixed(SIGNUP_EMAIL_COOKIE, secure), email, {
    ...pendingCookieOptions(secure),
    maxAge: PENDING_SIGNUP_MAX_AGE_SECONDS,
  });
}

/** Forgets both sign-up cookies (code accepted, address changed, or no longer usable). */
export async function clearSignupCookies(): Promise<void> {
  const store = await cookies();
  const secure = siteUsesHttps();
  const gone = { ...pendingCookieOptions(secure), maxAge: 0 };
  store.set(pendingCookieName(secure), "", gone);
  store.set(prefixed(SIGNUP_EMAIL_COOKIE, secure), "", gone);
}

export type CodeScreenState = {
  /** The address from the signed cookie: the code box acts on it. Null without a cookie. */
  email: string | null;
  /** Without a cookie: an address to fill in (from the log-in page), or "". */
  prefillEmail: string;
  /** Where the Resend countdown starts: the server's own cooldown for that address. */
  cooldownSeconds: number;
};

/** What the code screen needs from the request. The pending user's id is never part of it. */
export async function readCodeScreenState(): Promise<CodeScreenState> {
  // The cookie's age and the cooldown are read against the clock: only for a real request,
  // never while a prefetch prerenders the page.
  await connection();
  const store = await cookies();
  const prefill = prefillSchema.safeParse(store.get(prefixed(SIGNUP_EMAIL_COOKIE, siteUsesHttps()))?.value);
  const pending = await readPendingSignupCookie();
  const email = pending?.email ?? null;
  const prefillEmail = email === null && prefill.success ? prefill.data : "";
  const address = email ?? prefillEmail;
  const cooldownSeconds = address ? await secondsUntilEmailAllowed(getRateLimiter(), address) : 0;
  return { email, prefillEmail, cooldownSeconds };
}
