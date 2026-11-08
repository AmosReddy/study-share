import "server-only";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { z } from "zod";
import { siteUsesHttps } from "@/server/adapters/supabase-auth-cookies";
import { getRateLimiter } from "@/server/services";
import { secondsUntilEmailAllowed } from "./use-cases";

/*
  The Forgot password convenience cookie: the address the last code was requested for, so the
  code screen can show it and a reload resumes. It is plain (not signed) on purpose: it decides
  nothing. The address is only shown, used as the address to check the code against (exactly as
  if it had been typed) and to resend to; Forgot password replies the same for every address.

  httpOnly, same-site, only sent to /reset-password pages, and short-lived (codes last 10
  minutes). Cookies are always read before the settings, so a build without secrets never
  reaches getServerEnv().
*/

const RESET_EMAIL_COOKIE = "reset-email";
const RESET_EMAIL_PATH = "/reset-password";
/** Seconds. Longer than a code lives, so the screen still shows the address for a resend. */
export const RESET_EMAIL_MAX_AGE_SECONDS = 30 * 60;

const addressSchema = z.email().max(320);

/** `__Secure-` on https, so neither an http page nor an http sibling site can plant it. */
const cookieName = (secure: boolean) => (secure ? `__Secure-${RESET_EMAIL_COOKIE}` : RESET_EMAIL_COOKIE);

const cookieOptions = (secure: boolean, maxAge: number) => ({
  httpOnly: true,
  secure,
  sameSite: "lax" as const,
  path: RESET_EMAIL_PATH,
  maxAge,
});

/** The address the last code was requested for in this browser, or null (missing or not an address). */
export async function readResetEmailCookie(): Promise<string | null> {
  const store = await cookies();
  const parsed = addressSchema.safeParse(store.get(cookieName(siteUsesHttps()))?.value);
  return parsed.success ? parsed.data : null;
}

/** Remembers the address a code was just requested for. Server actions only. */
export async function writeResetEmailCookie(email: string): Promise<void> {
  const store = await cookies();
  const secure = siteUsesHttps();
  store.set(cookieName(secure), email, cookieOptions(secure, RESET_EMAIL_MAX_AGE_SECONDS));
}

/** Forgets the address (code accepted, or the person changes the address). Server actions only. */
export async function clearResetEmailCookie(): Promise<void> {
  const store = await cookies();
  const secure = siteUsesHttps();
  store.set(cookieName(secure), "", cookieOptions(secure, 0));
}

export type ResetScreenState = {
  /** The remembered address, or null: the screen then asks for it. */
  email: string | null;
  /** Where the Resend countdown starts: the server's own cooldown for that address. */
  cooldownSeconds: number;
};

/** What the reset code screen needs from the request. */
export async function readResetScreenState(): Promise<ResetScreenState> {
  // The cooldown is read against the clock: only for a real request, never while a prefetch
  // prerenders the page.
  await connection();
  const email = await readResetEmailCookie();
  const cooldownSeconds = email ? await secondsUntilEmailAllowed(getRateLimiter(), email) : 0;
  return { email, cooldownSeconds };
}
