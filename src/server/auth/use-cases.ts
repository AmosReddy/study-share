import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { AccountDirectory, EmailAccountState } from "@/server/ports/account-directory";
import { AuthProviderError, type AuthProvider, type AuthUser, type CodeKind } from "@/server/ports/auth-provider";
import type { ProfileStore } from "@/server/ports/profile-store";
import type { RateLimiter } from "@/server/ports/rate-limiter";
import { AUTH_MESSAGES } from "@/shared/auth-messages";
import {
  displayNameSchema,
  forgotPasswordSchema,
  loginSchema,
  normalizeCode,
  resetPasswordSchema,
  signUpSchema,
} from "@/shared/auth-schemas";
import { TERMS_VERSION } from "@/shared/legal";
import { safeNextPath } from "@/shared/safe-next-path";
import type { PendingSignup } from "./pending-signup-cookie";
import {
  CODE_ATTEMPTS,
  CODE_ATTEMPTS_IP,
  EMAIL_SEND_COOLDOWN,
  emailSendKey,
  RECOVERY_MINTED_COOLDOWN,
  recoveryMintedKey,
  LOGIN_EMAIL_LIMIT,
  LOGIN_IP_LIMIT,
  PASSWORD_RESET_EMAIL_LIMIT,
  PASSWORD_RESET_IP_LIMIT,
  PASSWORD_UPDATE_USER_LIMIT,
  RESEND_EMAIL_LIMIT,
  SIGN_UP_EMAIL_LIMIT,
  SIGN_UP_IP_LIMIT,
  type Limit,
} from "./rate-limit-policy";

/*
  Sign-in and account use-cases. Plain functions over ports, so they run in unit
  tests with the fakes. They validate, rate limit, call the provider and return
  results that do not say whether an address is registered (one known exception, see
  emailFlowFailure), and never contain vendor text, tokens or passwords.
*/

export type Deps = {
  auth: AuthProvider;
  limiter: RateLimiter;
  siteUrl: string;
  ip: string;
  /** Who has an account; removes unconfirmed sign-ups. */
  directory: AccountDirectory;
  /** The app's profile rows: the terms acceptance the profile trigger only fills once. */
  profiles: ProfileStore;
  /**
   * The pending sign-up this browser created, read by the caller from the signed cookie
   * (readPendingSignup), or null. Trusted only to tell this browser's own pending account from
   * someone else's (spec 5.1) and to know the address; never to sign anyone in.
   */
  pending: PendingSignup | null;
};

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; fieldErrors?: Record<string, string>; formError?: string; retryAfterSeconds?: number };

type Failure = Extract<ActionResult, { ok: false }>;

/** Set as `formError` when the email is not confirmed yet. The screen turns it into copy and a Resend button. */
export const CONFIRM_EMAIL_CODE = "confirm_email";

/** All wording lives in src/shared/auth-messages.ts. */
const MESSAGES = AUTH_MESSAGES;

/** `termsVersion` is checked by hand so a mismatch is a form error, not a field error. */
const termsSchema = z.object({ acceptTerms: signUpSchema.shape.acceptTerms, termsVersion: z.unknown() });
const profileSchema = z.object({ displayName: displayNameSchema });
const newPasswordSchema = resetPasswordSchema.extend({ confirmPassword: z.string() });

function parse<S extends z.ZodType>(schema: S, raw: unknown): { data: z.output<S> } | { failure: Failure } {
  const result = schema.safeParse(raw);
  if (result.success) return { data: result.data };
  const fieldErrors: Record<string, string> = {};
  let formError: string | undefined;
  for (const issue of result.error.issues) {
    const field = issue.path[0];
    if (typeof field === "string") fieldErrors[field] ??= issue.message;
    else formError ??= MESSAGES.badForm;
  }
  return {
    failure: {
      ok: false,
      ...(Object.keys(fieldErrors).length > 0 ? { fieldErrors } : {}),
      ...(formError ? { formError } : {}),
    },
  };
}

/** One limit to count. `message` replaces the usual "too many attempts" when this one refuses. */
type Check = { key: string; limit: Limit; message?: string };

/**
 * The shared one-email-a-minute cooldown. It comes first, so a quick repeat (a double tap)
 * is refused before it uses up any hourly allowance.
 */
const emailSendCheck = (email: string): Check => ({
  key: emailSendKey(email),
  limit: EMAIL_SEND_COOLDOWN,
  message: MESSAGES.justSent,
});

const MAX_IP_LENGTH = 64;

/**
 * The per-IP check, or none when the address is unknown (empty). Skipping is deliberate:
 * a shared "unknown" bucket would let one visitor use up the limit for everyone.
 */
function ipCheck(prefix: string, ip: string, limit: Limit): Check[] {
  const address = ip.trim().slice(0, MAX_IP_LENGTH);
  return address === "" ? [] : [{ key: `${prefix}:ip:${address}`, limit }];
}

/**
 * For the flows that send an email (sign-up, resend, reset). A provider rate limit (per address,
 * per IP, or the project's hourly email quota) means nothing was sent, so the person is told so
 * instead of "check your email". This code gives the same answer for every address, and our own
 * cooldown keeps quick repeats from reaching the provider. That is not a guarantee that the message
 * hides whether an address has an account: Supabase only reaches its email limits when it actually
 * sends an email, so someone who deliberately drains the project's email quota first could still
 * learn something from which addresses get this message. Accepted for the pilot, see "Known risks
 * accepted for the pilot" in the Phase 1 spec. The fixed line has no email, key or IP.
 */
function emailFlowFailure(error: unknown): Failure {
  if (error instanceof AuthProviderError && error.code === "rate_limited") {
    console.warn("Auth provider refused to send an email (rate limited); told the person to try again later.");
    return { ok: false, formError: MESSAGES.couldNotSend };
  }
  return providerFailure(error);
}

/** How long one limiter hit may take before it counts as a store failure (fail open). */
const LIMITER_TIMEOUT_MS = 2000;

/** The hit (or peek), or a rejection once LIMITER_TIMEOUT_MS has passed. The timer never outlives the call. */
async function hitWithTimeout(limiter: RateLimiter, input: Parameters<RateLimiter["hit"]>[0], op: "hit" | "peek" = "hit") {
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
 * Counts each check and returns a failure for the first one that is over its limit.
 * A limiter that throws, or takes over 2 seconds, never blocks anyone: one warning is logged
 * (with no key, email, IP or error text) and that hit counts as allowed.
 */
async function overLimit(limiter: RateLimiter, checks: Check[]): Promise<Failure | null> {
  let storeFailed = false;
  let refusal: Failure | null = null;
  for (const { key, limit, message } of checks) {
    try {
      const result = await hitWithTimeout(limiter, { key, limit: limit.limit, windowSeconds: limit.windowSeconds });
      if (!result.allowed) {
        refusal = {
          ok: false,
          formError: message ?? MESSAGES.tooMany,
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

/** Turns a provider error into a safe result. Anything that is not a provider error is a bug and is rethrown. */
function providerFailure(error: unknown): Failure {
  if (!(error instanceof AuthProviderError)) throw error;
  switch (error.code) {
    case "rate_limited":
      return { ok: false, formError: MESSAGES.tooMany };
    case "weak_password":
      return { ok: false, fieldErrors: { password: MESSAGES.weakPassword } };
    default:
      return { ok: false, formError: MESSAGES.generic };
  }
}


export async function logIn(deps: Deps, raw: unknown, next: unknown): Promise<ActionResult<{ redirectTo: string }>> {
  const parsed = parse(loginSchema, raw);
  if ("failure" in parsed) return parsed.failure;
  const { email, password } = parsed.data;

  const refused = await overLimit(deps.limiter, [
    { key: `login:email:${email}`, limit: LOGIN_EMAIL_LIMIT },
    ...ipCheck("login", deps.ip, LOGIN_IP_LIMIT),
  ]);
  if (refused) return refused;

  try {
    const result = await deps.auth.signInWithPassword({ email, password });
    if (!result.ok) {
      return {
        ok: false,
        formError: result.reason === "email_not_confirmed" ? CONFIRM_EMAIL_CODE : MESSAGES.badLogin,
      };
    }
  } catch (error) {
    return providerFailure(error);
  }
  return { ok: true, data: { redirectTo: safeNextPath(next) } };
}

export async function startGoogle(deps: Deps, next: unknown): Promise<ActionResult<{ url: string }>> {
  try {
    // Google returns to this absolute, same-site address (made safe here).
    const { url } = await deps.auth.startGoogleSignIn({ redirectTo: deps.siteUrl + safeNextPath(next) });
    return { ok: true, data: { url } };
  } catch (error) {
    return providerFailure(error);
  }
}

export async function acceptTerms(deps: Deps, raw: unknown, next: unknown): Promise<ActionResult<{ redirectTo: string }>> {
  const parsed = parse(termsSchema, raw);
  if ("failure" in parsed) return parsed.failure;
  // Only accept the version the person was shown. The version we record is always TERMS_VERSION.
  if (parsed.data.termsVersion !== TERMS_VERSION) return { ok: false, formError: MESSAGES.termsChanged };

  try {
    const user = await deps.auth.getUser();
    if (!user) return { ok: false, formError: MESSAGES.sessionEnded };
    // The profile row first: if the metadata write then fails, the terms gate still shows this
    // page and a second try records both. The other order could leave the profile without it.
    await recordProfileTerms(deps.profiles, user.id);
    await deps.auth.acceptTerms({ termsVersion: TERMS_VERSION });
  } catch (error) {
    return providerFailure(error);
  }
  return { ok: true, data: { redirectTo: safeNextPath(next) } };
}

/**
 * Runs a ProfileStore write. Its failures are database errors, so they become one fixed warning
 * and AuthProviderError("unavailable") (the plain "something went wrong", no SQL or id logged).
 * A missing profile row is not a reason to refuse the person: it is logged and passed over.
 */
async function fromProfiles(call: Promise<boolean>): Promise<void> {
  let updated: boolean;
  try {
    updated = await call;
  } catch {
    console.warn("Profile store unavailable.");
    throw new AuthProviderError("unavailable");
  }
  if (!updated) console.warn("No profile row to record the terms on.");
}

/** Records on the profile row that this user accepted the current terms now (P12). */
const recordProfileTerms = (profiles: ProfileStore, userId: string) =>
  fromProfiles(profiles.recordTermsAcceptance(userId, TERMS_VERSION));

export async function updateProfile(deps: Deps, raw: unknown): Promise<ActionResult> {
  const parsed = parse(profileSchema, raw);
  if ("failure" in parsed) return parsed.failure;

  try {
    await deps.auth.updateDisplayName(parsed.data.displayName);
  } catch (error) {
    return providerFailure(error);
  }
  return { ok: true, data: undefined };
}

/**
 * Signs the person out. A failure is reported, never swallowed: the session may still be live,
 * and the screen must say so. The provider's own text is never shown or logged.
 */
export async function logOut(deps: Pick<Deps, "auth">): Promise<ActionResult> {
  try {
    await deps.auth.signOut();
  } catch (error) {
    if (!(error instanceof AuthProviderError)) throw error;
    console.warn("Log out failed at the auth provider.");
    return { ok: false, formError: MESSAGES.logOutFailed };
  }
  return { ok: true, data: undefined };
}

/* ------------------------------------------------------------------------------------------
   Emailed codes (registration redesign, spec 2026-11-07, sections 4 to 6).

   Nothing below logs or returns a code, password, address, user id or IP; the few warnings
   are fixed sentences.
------------------------------------------------------------------------------------------ */

const normaliseEmail = (email: string) => email.trim().toLowerCase();

/**
 * Runs an AccountDirectory call. Its failures are database errors (not AuthProviderError), so
 * they become one fixed warning and AuthProviderError("unavailable"): the person sees the plain
 * "something went wrong" instead of an error page, and no SQL text or address is logged.
 */
async function fromDirectory<T>(call: Promise<T>): Promise<T> {
  try {
    return await call;
  } catch (error) {
    if (error instanceof AuthProviderError) throw error;
    console.warn("Account directory unavailable.");
    throw new AuthProviderError("unavailable");
  }
}

/** Signs out after a step failed. A failed sign-out is logged (fixed line) and otherwise ignored. */
async function signOutQuietly(auth: AuthProvider): Promise<void> {
  try {
    await auth.signOut();
  } catch {
    console.warn("Signing out after a failed step also failed.");
  }
}

const mintedInput = (email: string) => ({
  key: recoveryMintedKey(email),
  limit: RECOVERY_MINTED_COOLDOWN.limit,
  windowSeconds: RECOVERY_MINTED_COOLDOWN.windowSeconds,
});

/**
 * Starts the minted-recovery cooldown for an address. Called just before every
 * openSessionWithoutEmail (also when that then fails): the provider records the minted session
 * as a recovery request and would answer a recovery email within about a minute with a rate
 * limit, so the app's own countdown must be the one the person sees (ruling P11). Only this
 * function hits the key, so its window starts at the mint, even while an email-send window that
 * started earlier (at sign-up) is still open. Fails open.
 */
async function startMintedCooldown(limiter: RateLimiter, email: string): Promise<void> {
  try {
    await hitWithTimeout(limiter, mintedInput(email));
  } catch {
    console.warn("Rate limit store unavailable; the email cooldown was not started.");
  }
}

/**
 * The cooldown result (the same one the email-send cooldown gives, with its countdown) while a
 * minted recovery session for this address is less than a minute old, else null. Read with
 * peek, so checking never opens a window. Runs before the other limits, so a refused request
 * uses up nothing. Fails open with the usual single warning.
 */
async function mintedCooldownRefusal(limiter: RateLimiter, email: string): Promise<Failure | null> {
  try {
    const answer = await hitWithTimeout(limiter, mintedInput(email), "peek");
    if (!answer.allowed) {
      return { ok: false, formError: MESSAGES.justSent, retryAfterSeconds: Math.max(1, answer.retryAfterSeconds) };
    }
  } catch {
    console.warn("Rate limit store unavailable; allowing the request.");
  }
  return null;
}

/** "Google-only": a Google identity and no email identity. Not from hasPassword (see the port doc). */
function isGoogleOnly(state: Extract<EmailAccountState, { kind: "confirmed" }>): boolean {
  return state.providers.includes("google") && !state.providers.includes("email");
}

type SignUpInput = z.output<typeof signUpSchema>;
type CreateOutcome = { kind: "ok"; userId: string } | { kind: "taken" } | { kind: "mismatch" };

/**
 * Creates the pending account and proves the password on it is the one this person typed
 * (spec 5.1). The provider keeps the FIRST password of an unconfirmed address and its returned
 * id may be "" or a stand-in, so neither is trusted: the directory names the pending account
 * before and after the self-check, and only an unchanged id counts. Ids are never reused, so
 * the same id at both reads means the self-check ran against that very account.
 */
async function createAndCheck(deps: Deps, input: SignUpInput): Promise<CreateOutcome> {
  const { email, password, displayName } = input;
  await deps.auth.signUpWithPassword({ email, password, displayName, termsVersion: TERMS_VERSION });

  const before = await fromDirectory(deps.directory.describeEmail(email));
  if (before.kind === "confirmed") return { kind: "taken" };
  if (before.kind === "none") return { kind: "mismatch" };

  // An unconfirmed account answers email_not_confirmed only for its own password (checked live).
  const check = await deps.auth.signInWithPassword({ email, password });
  if (check.ok) {
    // Confirmed in the meantime, with this very password: not a sign-up any more. Leave no session.
    await signOutQuietly(deps.auth);
    return { kind: "taken" };
  }
  if (check.reason !== "email_not_confirmed") return { kind: "mismatch" };

  const after = await fromDirectory(deps.directory.describeEmail(email));
  if (after.kind !== "pending" || after.userId !== before.userId) return { kind: "mismatch" };
  return { kind: "ok", userId: after.userId };
}

/**
 * Email sign-up (spec 4.1, 5.1, 5.2). Says clearly when the address already has an account (the
 * owner's choice), and creates and sends nothing then. Otherwise replaces any unconfirmed
 * sign-up for the address (newest wins), creates the pending account (which emails a code),
 * proves the password on it and, if someone else's sign-up got there first, removes and
 * recreates it once.
 *
 * On success the caller sets the pending sign-up cookie to `{ userId: pendingUserId, email }`
 * (signPendingSignup) and shows the code screen, which carries `next` on to verifySignUpCode.
 */
export async function signUp(deps: Deps, raw: unknown): Promise<ActionResult<{ pendingUserId: string; email: string }>> {
  const parsed = parse(signUpSchema, raw);
  if ("failure" in parsed) return parsed.failure;
  const { email } = parsed.data;

  // The cooldowns and limits come before the lookup, so the "already registered" answer is
  // protected by them too (spec 5).
  const minted = await mintedCooldownRefusal(deps.limiter, email);
  if (minted) return minted;
  const refused = await overLimit(deps.limiter, [
    emailSendCheck(email),
    { key: `signup:email:${email}`, limit: SIGN_UP_EMAIL_LIMIT },
    ...ipCheck("signup", deps.ip, SIGN_UP_IP_LIMIT),
  ]);
  if (refused) return refused;

  try {
    const state = await fromDirectory(deps.directory.describeEmail(email));
    if (state.kind === "confirmed") {
      return { ok: false, formError: isGoogleOnly(state) ? MESSAGES.googleOnly : MESSAGES.emailTaken };
    }
    if (state.kind === "pending") await fromDirectory(deps.directory.removePendingSignup(email));

    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await fromDirectory(deps.directory.removePendingSignup(email));
      const outcome = await createAndCheck(deps, parsed.data);
      if (outcome.kind === "ok") return { ok: true, data: { pendingUserId: outcome.userId, email } };
      if (outcome.kind === "taken") return { ok: false, formError: MESSAGES.emailTaken };
    }
    console.warn("Sign-up could not prove the password on the pending account twice; gave up.");
    return { ok: false, formError: MESSAGES.generic };
  } catch (error) {
    return emailFlowFailure(error);
  }
}

/** The address and the normalised code from a code form, or field errors. Nothing is counted yet. */
function parseCodeForm(
  raw: unknown,
  knownEmail: string | null,
): { data: { email: string; code: string } } | { failure: Failure } {
  const fields = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const fieldErrors: Record<string, string> = {};

  let email = knownEmail === null ? null : normaliseEmail(knownEmail);
  if (email === null) {
    const parsed = parse(forgotPasswordSchema, { email: fields.email });
    if ("failure" in parsed) Object.assign(fieldErrors, parsed.failure.fieldErrors);
    else email = parsed.data.email;
  }
  const code = typeof fields.code === "string" ? normalizeCode(fields.code) : null;
  if (code === null) fieldErrors.code = MESSAGES.codeFormat;

  if (email === null || code === null) return { failure: { ok: false, fieldErrors } };
  return { data: { email, code } };
}

/**
 * Counts the attempt (5 per address per 15 minutes, shared by both kinds of code and not reset
 * by a resend; 30 per IP per hour), then checks the code. A provider limit or outage is told as
 * such, never as a wrong code, so nobody is told to retype a right code during an outage.
 */
async function checkCode(
  deps: Deps,
  email: string,
  code: string,
  kind: CodeKind,
  beforeVerify?: () => Promise<void>,
): Promise<{ userId: string } | { failure: Failure }> {
  const refused = await overLimit(deps.limiter, [
    { key: `code:email:${email}`, limit: CODE_ATTEMPTS, message: MESSAGES.tooManyCodes },
    ...ipCheck("code", deps.ip, CODE_ATTEMPTS_IP),
  ]);
  if (refused) return { failure: refused };

  if (beforeVerify) {
    try {
      await beforeVerify();
    } catch {
      return { failure: { ok: false, formError: MESSAGES.codeCheckUnavailable } };
    }
  }

  try {
    const result = await deps.auth.verifyCode({ email, code, kind });
    if (!result.ok) return { failure: { ok: false, formError: MESSAGES.codeInvalid } };
    return { userId: result.userId };
  } catch (error) {
    if (!(error instanceof AuthProviderError)) throw error;
    const formError = error.code === "rate_limited" ? MESSAGES.tooMany : MESSAGES.codeCheckUnavailable;
    return { failure: { ok: false, formError } };
  }
}

/** How many times the scramble is tried before giving up (it is the step that kills a stranger's password). */
const SCRAMBLE_ATTEMPTS = 2;

/**
 * Logged when a stranger's password may still work: after a code from another sign-up, neither
 * the admin scramble nor a password change from the code session could replace it. Fixed text
 * (no address, id or password) that operations can alert on.
 */
export const PASSWORD_NOT_REPLACED_WARNING =
  "SECURITY: after a code from another sign-up the password could not be replaced; the account may still accept the other sign-up's password.";

/** A password nobody knows, as scramblePassword makes: 32 random bytes plus a suffix that meets any password policy. */
function randomPassword(): string {
  return `${randomBytes(32).toString("base64url")}!aA1`;
}

/** Tries the scramble SCRAMBLE_ATTEMPTS times. Any error counts as "not scrambled". */
async function scrambleWithRetry(auth: AuthProvider, userId: string): Promise<boolean> {
  for (let attempt = 0; attempt < SCRAMBLE_ATTEMPTS; attempt++) {
    try {
      await auth.scramblePassword(userId);
      return true;
    } catch {
      // Tried again, then the caller decides.
    }
  }
  return false;
}

/**
 * A code confirmed an account this browser did not create, or there is no cookie (spec 5.1,
 * ruling P9). Order (final review I1: nothing is written while the account, now confirmed,
 * still accepts the other sign-up's password):
 * 1. replace the password with a random one at once (the auth server then rejects every session
 *    of the account, including the one the code just made). If the admin scramble fails twice,
 *    the code session is still alive, so the password is replaced from it instead (Task 4),
 *    then the details below, then the person is signed out;
 * 2. the name and terms that came from whoever signed up are replaced with the admin client
 *    (no session needed), tried twice (P13);
 * 3. the email cooldown starts and a fresh session opens here for exactly the user the code
 *    proved;
 * 4. only if step 2 failed: the same writes from that fresh session, the last fallback.
 * The person must then create a password (setPassword). Returns a failure, after signing the
 * person out, when the account cannot be left safe and clean for them.
 */
async function takeOverForeignCode(deps: Deps, email: string, userId: string): Promise<Failure | null> {
  if (!(await scrambleWithRetry(deps.auth, userId))) {
    // Nothing scrambled, so the code session verifyCode opened is still alive, and a password
    // change works from a code session (probes l2, o): replace the password that way, through a
    // different API path from the admin call that failed. The value is never kept.
    try {
      await deps.auth.updatePassword(randomPassword());
      console.warn("Replaced the password from the code session after the scramble failed; signed the person out.");
    } catch {
      console.warn(PASSWORD_NOT_REPLACED_WARNING);
    }
    // The person is sent to Forgot password, which never touches the name or terms.
    await replaceDetailsAsAdmin(deps, email, userId);
    await signOutQuietly(deps.auth);
    return { ok: false, formError: MESSAGES.confirmedSetPassword };
  }

  const detailsReplaced = await replaceDetailsAsAdmin(deps, email, userId);

  // Started before the attempt: even a failed one may have recorded a recovery request.
  await startMintedCooldown(deps.limiter, email);
  try {
    await deps.auth.openSessionWithoutEmail({ email, expectedUserId: userId });
  } catch {
    console.warn("Could not open a session after replacing the password; signed the person out.");
    await signOutQuietly(deps.auth);
    return { ok: false, formError: MESSAGES.confirmedSetPassword };
  }
  // The person must not go on under the other sign-up's name and terms: without them replaced,
  // the terms gate would never ask this person to accept. The password is already random.
  if (!detailsReplaced && !(await replaceOtherSignUpsDetails(deps, email, userId))) {
    console.warn("Could not replace the other sign-up's name and terms; signed the person out.");
    await signOutQuietly(deps.auth);
    return { ok: false, formError: MESSAGES.confirmedSetPassword };
  }
  return null;
}

/** How many times the admin writes of a takeover or repair are tried. */
const ADMIN_WRITE_ATTEMPTS = 2;

/** Runs `write` up to ADMIN_WRITE_ATTEMPTS times; true once it succeeds. Errors are not logged here. */
async function withRetry(write: () => Promise<void>): Promise<boolean> {
  for (let attempt = 0; attempt < ADMIN_WRITE_ATTEMPTS; attempt++) {
    try {
      await write();
      return true;
    } catch {
      // Tried again, then the caller decides.
    }
  }
  return false;
}

/**
 * For an account a foreign code confirmed (P13), with no session: the name becomes the address's
 * local part and the terms acceptance is cleared (metadata through the provider's admin power,
 * and the profile row), so the terms gate sends the person to /welcome. Tried twice. True when
 * both writes succeeded; a failure is one fixed warning.
 */
async function replaceDetailsAsAdmin(deps: Deps, email: string, userId: string): Promise<boolean> {
  const done = await withRetry(async () => {
    await deps.auth.resetUserMetadata(userId, { displayName: nameFromEmail(email) });
    await fromProfiles(deps.profiles.clearTermsAcceptance(userId));
  });
  if (!done) console.warn("Could not replace the other sign-up's name and terms with the admin client.");
  return done;
}

/** A display name from an address: its local part, within the name rules, else "New user". */
function nameFromEmail(email: string): string {
  return validName(email.split("@")[0] ?? "") ?? "New user";
}

/** `candidate` trimmed and cut to 50 characters (code points) if it then passes the name rules, else null. */
function validName(candidate: string): string | null {
  const parsed = displayNameSchema.safeParse(Array.from(candidate.trim()).slice(0, 50).join(""));
  return parsed.success ? parsed.data : null;
}

/**
 * The last fallback for replaceDetailsAsAdmin: the same writes from the fresh session the
 * takeover opened (needs a live session of that user). True when all three writes succeeded;
 * any failure is one fixed warning.
 */
async function replaceOtherSignUpsDetails(deps: Deps, email: string, userId: string): Promise<boolean> {
  try {
    await deps.auth.updateDisplayName(nameFromEmail(email));
    await deps.auth.clearTermsAcceptance();
    await fromProfiles(deps.profiles.clearTermsAcceptance(userId));
    return true;
  } catch {
    console.warn("Could not replace the other sign-up's name and terms.");
    return false;
  }
}

/**
 * Checks a sign-up code (spec 4.1, 5.1). With a cookie, the code box acts on the cookie's
 * address; without one, on the address typed in. A code that confirms the cookie's own pending
 * account signs the person in (`needsPassword: false`). Any other confirmed account (another
 * sign-up's, or no cookie at all) has its password replaced and gets a fresh session here, and
 * the person must create a password next (`needsPassword: true`, then setPassword).
 *
 * The caller clears the pending cookie once this succeeds.
 */
export async function verifySignUpCode(
  deps: Deps,
  raw: unknown,
  next: unknown,
): Promise<ActionResult<{ redirectTo: string; needsPassword: boolean }>> {
  const form = parseCodeForm(raw, deps.pending?.email ?? null);
  if ("failure" in form) return form.failure;
  const { email, code } = form.data;

  const checked = await checkCode(deps, email, code, "signup");
  if ("failure" in checked) return checked.failure;

  const ownPendingAccount = deps.pending !== null && deps.pending.userId === checked.userId;
  if (!ownPendingAccount) {
    const failed = await takeOverForeignCode(deps, email, checked.userId);
    if (failed) return failed;
  }
  return { ok: true, data: { redirectTo: safeNextPath(next), needsPassword: !ownPendingAccount } };
}

/**
 * Seconds until an email to this address may be sent again (the shared one-email-a-minute
 * cooldown, or the minted-recovery cooldown), or 0. Read only (peek): it counts nothing and
 * opens no window, so the code screen can start its countdown where the server will. The answer
 * depends only on the counters, never on whether the address has an account. Fails open (0).
 */
export async function secondsUntilEmailAllowed(limiter: RateLimiter, rawEmail: string): Promise<number> {
  const email = normaliseEmail(rawEmail);
  let seconds = 0;
  for (const input of [
    { key: emailSendKey(email), limit: EMAIL_SEND_COOLDOWN.limit, windowSeconds: EMAIL_SEND_COOLDOWN.windowSeconds },
    mintedInput(email),
  ]) {
    try {
      const answer = await hitWithTimeout(limiter, input, "peek");
      if (!answer.allowed) seconds = Math.max(seconds, Math.max(1, answer.retryAfterSeconds));
    } catch {
      // Fails open: the countdown starts at 0 and the server still decides on the next send.
    }
  }
  return seconds;
}

/** Emails a new sign-up code to the cookie's address (or the one typed in). Neutral for any address. */
export async function resendSignUpCode(deps: Deps, raw: unknown): Promise<ActionResult> {
  let email: string;
  if (deps.pending) {
    email = normaliseEmail(deps.pending.email);
  } else {
    const parsed = parse(forgotPasswordSchema, raw);
    if ("failure" in parsed) return parsed.failure;
    email = parsed.data.email;
  }

  const minted = await mintedCooldownRefusal(deps.limiter, email);
  if (minted) return minted;
  const refused = await overLimit(deps.limiter, [
    emailSendCheck(email),
    { key: `resend:email:${email}`, limit: RESEND_EMAIL_LIMIT },
  ]);
  if (refused) return refused;

  try {
    await deps.auth.resendSignUpCode({ email });
  } catch (error) {
    return emailFlowFailure(error);
  }
  return { ok: true, data: undefined };
}

/**
 * Forgot password (spec 4.3): emails a recovery code. The reply is the same for every valid
 * address, known or not. A provider rate limit gets that same neutral reply too (ruling P11):
 * the minted sessions of 5.1 and 5.3 count as recovery requests at the provider, and our own
 * cooldown is the countdown the person sees.
 */
export async function requestPasswordReset(deps: Deps, raw: unknown): Promise<ActionResult<{ email: string }>> {
  const parsed = parse(forgotPasswordSchema, raw);
  if ("failure" in parsed) return parsed.failure;
  const { email } = parsed.data;

  const minted = await mintedCooldownRefusal(deps.limiter, email);
  if (minted) return minted;
  const refused = await overLimit(deps.limiter, [
    emailSendCheck(email),
    { key: `reset:email:${email}`, limit: PASSWORD_RESET_EMAIL_LIMIT },
    ...ipCheck("reset", deps.ip, PASSWORD_RESET_IP_LIMIT),
  ]);
  if (refused) return refused;

  try {
    await deps.auth.sendPasswordResetCode({ email });
  } catch (error) {
    if (!(error instanceof AuthProviderError && error.code === "rate_limited")) return providerFailure(error);
    console.warn("Auth provider refused a recovery email (rate limited); answered neutrally.");
  }
  return { ok: true, data: { email } };
}

/**
 * Whether the address carries someone else's unconfirmed email sign-up: a pending account, or a
 * Google account that still has an unverified email identity (a repair that failed before its
 * scramble). Read only. Must be read BEFORE a recovery code is checked: redeeming it confirms the
 * address and verifies the identity, after which neither can be seen.
 */
async function carriesPendingSignUp(deps: Deps, email: string): Promise<boolean> {
  const state = await fromDirectory(deps.directory.describeEmail(email));
  if (state.kind === "pending") return true;
  if (state.kind === "confirmed" && state.providers.includes("google")) {
    return fromDirectory(deps.directory.hasPendingEmailIdentity(state.userId));
  }
  return false;
}

/**
 * Checks a recovery code; on success this browser holds a recovery session for setPassword.
 *
 * A recovery code confirms an unconfirmed account, so on an address that carried a pending sign-up
 * (a stranger's password, name and terms) the account is taken over exactly as a foreign sign-up
 * code is (fix round 1): name and terms replaced, password scrambled, a fresh session opened for
 * the user the code proved. The reply is the same as for any other account, and a wrong code gets
 * the one message whatever the address; the state is read only after the attempt is counted.
 */
export async function verifyResetCode(deps: Deps, raw: unknown): Promise<ActionResult> {
  const form = parseCodeForm(raw, null);
  if ("failure" in form) return form.failure;
  const { email, code } = form.data;
  let pendingSignUp = false;
  const checked = await checkCode(deps, email, code, "recovery", async () => {
    pendingSignUp = await carriesPendingSignUp(deps, email);
  });
  if ("failure" in checked) return checked.failure;
  if (pendingSignUp) {
    const failed = await takeOverForeignCode(deps, email, checked.userId);
    if (failed) return failed;
  }
  return { ok: true, data: undefined };
}

/** True when this password now signs into the account (used only to learn whether a change happened). */
async function passwordWorks(auth: AuthProvider, email: string, password: string): Promise<boolean> {
  try {
    return (await auth.signInWithPassword({ email, password })).ok;
  } catch {
    return false;
  }
}

/**
 * Sets the password from the session a code just opened: after Forgot password (verifyResetCode)
 * or the forced step after a foreign code (verifySignUpCode with needsPassword). Every other
 * session of the account is signed out. The provider refuses a change from a password sign-in
 * session, so this is not a "change password" screen for signed-in people.
 *
 * If the provider reports a failure, the new password is tried: when it works, the change
 * happened and only signing out the other devices failed, which `notice` says honestly.
 */
export async function setPassword(
  deps: Deps,
  raw: unknown,
  next: unknown = "/",
): Promise<ActionResult<{ redirectTo: string; notice?: string }>> {
  const parsed = parse(newPasswordSchema, raw);
  if ("failure" in parsed) return parsed.failure;
  const { password, confirmPassword } = parsed.data;
  if (password !== confirmPassword) {
    return { ok: false, fieldErrors: { confirmPassword: MESSAGES.passwordsDiffer } };
  }
  const redirectTo = safeNextPath(next);

  try {
    const user = await deps.auth.getUser();
    if (!user) return { ok: false, formError: MESSAGES.sessionEnded };

    const refused = await overLimit(deps.limiter, [
      { key: `password-update:user:${user.id}`, limit: PASSWORD_UPDATE_USER_LIMIT },
    ]);
    if (refused) return refused;

    try {
      await deps.auth.updatePassword(password, { signOutOthers: true });
    } catch (error) {
      // Opened with the password, not a code: nothing changed, and Forgot password is the way.
      if (error instanceof AuthProviderError && error.code === "reauth_required") {
        return { ok: false, formError: MESSAGES.useForgotPassword };
      }
      if (!(error instanceof AuthProviderError) || error.code !== "unavailable") throw error;
      if (!(await passwordWorks(deps.auth, user.email, password))) throw error;
      console.warn("Password changed, but signing out the other sessions failed.");
      return { ok: true, data: { redirectTo, notice: MESSAGES.otherDevicesMaybeSignedIn } };
    }
  } catch (error) {
    return providerFailure(error);
  }
  return { ok: true, data: { redirectTo } };
}

/** The Google user's own name for the repair: Google's, else the address's local part, within the name rules. */
function googleDisplayName(user: AuthUser): string {
  return validName(user.providerName ?? "") ?? nameFromEmail(user.email);
}

/**
 * Runs right after a Google sign-in (spec 4.2, 5.3), with the user that sign-in returned.
 *
 * If the account has a pending email sign-up (a stranger's earlier password), in this order: the
 * display name and terms become the Google user's own (while the Google session works), the
 * password is replaced with a random one (tried twice; it also ends the Google session), the
 * pending identity is removed, the minted-recovery cooldown starts, and a fresh session is
 * opened here for this same user with no second Google trip. Detection is read only and the
 * removal follows the scramble, so a repair that fails before then is repeated at the next
 * sign-in; one that fails after it has already removed everything of the stranger's.
 * Otherwise the terms rule applies: no accepted version is recorded as accepted now (the person
 * pressed the button under the "By continuing you confirm..." sentence); an out-of-date
 * version goes to /welcome. A confirmed password account that signs in with Google is left as
 * it is.
 *
 * Any failure signs the person out and returns the Google message.
 */
export async function repairGoogleAccount(
  deps: Deps,
  user: AuthUser,
  next: unknown = "/",
): Promise<ActionResult<{ redirectTo: string }>> {
  const target = safeNextPath(next);
  const email = normaliseEmail(user.email);
  try {
    // Read only: the pending identity is removed only once the stranger's password, name and
    // terms are gone, so if any of those steps fails the next Google sign-in finds it again and
    // repeats them.
    if (await deps.directory.hasPendingEmailIdentity(user.id)) {
      // First, at once: kills the stranger's password and every session, the Google one
      // included (final review I1: nothing is written while that password still works).
      if (!(await scrambleWithRetry(deps.auth, user.id))) throw new Error("scramble failed");
      // With no session left: the name and terms become the Google user's own, in the metadata
      // and on the profile row (which the trigger fills only once). Tried twice; if that fails,
      // the identity stays and the next sign-in repeats the repair.
      const detailsWritten = await withRetry(async () => {
        await deps.auth.resetUserMetadata(user.id, { displayName: googleDisplayName(user), acceptedTermsVersion: TERMS_VERSION });
        await recordProfileTerms(deps.profiles, user.id);
      });
      if (!detailsWritten) throw new Error("details not written");
      // Before the minted session: redeeming a recovery code confirms the address, which marks
      // the email identity verified, and a verified identity is no longer removed.
      await deps.directory.repairAfterGoogle(user.id);
      await startMintedCooldown(deps.limiter, email);
      await deps.auth.openSessionWithoutEmail({ email, expectedUserId: user.id });
      return { ok: true, data: { redirectTo: target } };
    }
    if (!user.termsVersion) {
      // An account with no email identity is Google's alone. The provider may already have
      // repaired a stranger's sign-up itself (replacing the metadata with Google's claims), but
      // the profile trigger keeps an earlier typed name unless display_name is written: write the
      // Google user's name so the profile row follows (final review I3).
      const state = await deps.directory.describeEmail(email);
      if (state.kind === "confirmed" && !state.providers.includes("email")) {
        await deps.auth.updateDisplayName(googleDisplayName(user));
      }
      // Profile first: if the metadata write fails, the next sign-in still finds no version and
      // records both.
      await recordProfileTerms(deps.profiles, user.id);
      await deps.auth.acceptTerms({ termsVersion: TERMS_VERSION });
      return { ok: true, data: { redirectTo: target } };
    }
    if (user.termsVersion !== TERMS_VERSION) {
      return { ok: true, data: { redirectTo: target === "/" ? "/welcome" : `/welcome?next=${encodeURIComponent(target)}` } };
    }
    return { ok: true, data: { redirectTo: target } };
  } catch {
    // Any failure, database or provider: never leave a half-repaired session behind.
    console.warn("Completing a Google sign-in failed; signed the person out.");
    await signOutQuietly(deps.auth);
    return { ok: false, formError: MESSAGES.googleFailed };
  }
}

/** Set as `formError` when Google sent no usable code (or finishing it failed): nothing was signed in. */
export const GOOGLE_NOT_FINISHED = "google_not_finished";

/**
 * Where Google sign-in returns (/auth/callback): finishes the sign-in with Google's one-time
 * `code`, then runs repairGoogleAccount (the pre-registration repair and the terms rule) for the
 * user that sign-in opened. Never skips the repair: a session whose user cannot be read is
 * signed out with the Google message, like any failed repair. A missing, unknown or used code
 * (or a provider failure while finishing) is GOOGLE_NOT_FINISHED, with nothing signed in.
 */
export async function completeGoogleSignIn(
  deps: Deps,
  code: string,
  next: unknown,
): Promise<ActionResult<{ redirectTo: string }>> {
  let signedIn = false;
  try {
    signedIn = code !== "" && (await deps.auth.completeOAuth(code));
  } catch {
    console.warn("Finishing a Google sign-in failed at the auth provider.");
  }
  if (!signedIn) return { ok: false, formError: GOOGLE_NOT_FINISHED };

  let user: AuthUser | null = null;
  try {
    user = await deps.auth.getUser();
  } catch {
    // Handled below like a missing user.
  }
  if (!user) {
    console.warn("Reading the user after a Google sign-in failed; signed the person out.");
    await signOutQuietly(deps.auth);
    return { ok: false, formError: MESSAGES.googleFailed };
  }
  return repairGoogleAccount(deps, user, next);
}
