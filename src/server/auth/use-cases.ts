import { z } from "zod";
import { AuthProviderError, type AuthProvider } from "@/server/ports/auth-provider";
import type { RateLimiter } from "@/server/ports/rate-limiter";
import { displayNameSchema, forgotPasswordSchema, loginSchema, resetPasswordSchema, signUpSchema } from "@/shared/auth-schemas";
import { TERMS_VERSION } from "@/shared/legal";
import { safeNextPath } from "@/shared/safe-next-path";
import {
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
  results that never reveal whether an address is registered, and never contain
  vendor text, tokens or passwords.
*/

export type Deps = { auth: AuthProvider; limiter: RateLimiter; siteUrl: string; ip: string };

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; fieldErrors?: Record<string, string>; formError?: string; retryAfterSeconds?: number };

type Failure = Extract<ActionResult, { ok: false }>;

/** Set as `formError` when the email is not confirmed yet. The screen turns it into copy and a Resend button. */
export const CONFIRM_EMAIL_CODE = "confirm_email";

const MESSAGES = {
  tooMany: "Too many attempts. Please try again later.",
  generic: "Something went wrong. Please try again.",
  badLogin: "That email and password do not match.",
  badForm: "Check the form and try again.",
  weakPassword: "Choose a stronger password with at least 8 characters.",
  passwordsDiffer: "The two passwords do not match.",
  signInAgain: "Your session has ended. Please use the link in your email again.",
} as const;

const termsSchema = z.object({ acceptTerms: signUpSchema.shape.acceptTerms });
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

type Check = { key: string; limit: Limit };

/**
 * Counts each check and returns a failure for the first one that is over its limit.
 * A limiter that throws never blocks anyone: one warning is logged (with no key,
 * email, IP or error text) and that hit counts as allowed.
 */
async function overLimit(limiter: RateLimiter, checks: Check[]): Promise<Failure | null> {
  let storeFailed = false;
  let refusal: Failure | null = null;
  for (const { key, limit } of checks) {
    try {
      const result = await limiter.hit({ key, limit: limit.limit, windowSeconds: limit.windowSeconds });
      if (!result.allowed) {
        refusal = { ok: false, formError: MESSAGES.tooMany, retryAfterSeconds: Math.max(1, result.retryAfterSeconds) };
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

const confirmRedirect = (deps: Deps, next: unknown) => deps.siteUrl + safeNextPath(next);

export async function signUp(deps: Deps, raw: unknown, next: unknown): Promise<ActionResult<{ status: "check_email" }>> {
  const parsed = parse(signUpSchema, raw);
  if ("failure" in parsed) return parsed.failure;
  const { email, password, displayName } = parsed.data;

  const refused = await overLimit(deps.limiter, [
    { key: `signup:email:${email}`, limit: SIGN_UP_EMAIL_LIMIT },
    { key: `signup:ip:${deps.ip}`, limit: SIGN_UP_IP_LIMIT },
  ]);
  if (refused) return refused;

  try {
    await deps.auth.signUpWithPassword({
      email,
      password,
      displayName,
      termsVersion: TERMS_VERSION,
      redirectTo: confirmRedirect(deps, next),
    });
  } catch (error) {
    return providerFailure(error);
  }
  return { ok: true, data: { status: "check_email" } };
}

export async function logIn(deps: Deps, raw: unknown, next: unknown): Promise<ActionResult<{ redirectTo: string }>> {
  const parsed = parse(loginSchema, raw);
  if ("failure" in parsed) return parsed.failure;
  const { email, password } = parsed.data;

  const refused = await overLimit(deps.limiter, [
    { key: `login:email:${email}`, limit: LOGIN_EMAIL_LIMIT },
    { key: `login:ip:${deps.ip}`, limit: LOGIN_IP_LIMIT },
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

export async function resendConfirmation(deps: Deps, raw: unknown, next: unknown): Promise<ActionResult> {
  const parsed = parse(forgotPasswordSchema, raw);
  if ("failure" in parsed) return parsed.failure;
  const { email } = parsed.data;

  const refused = await overLimit(deps.limiter, [{ key: `resend:email:${email}`, limit: RESEND_EMAIL_LIMIT }]);
  if (refused) return refused;

  try {
    await deps.auth.resendConfirmation({ email, redirectTo: confirmRedirect(deps, next) });
  } catch (error) {
    return providerFailure(error);
  }
  return { ok: true, data: undefined };
}

export async function requestPasswordReset(deps: Deps, raw: unknown): Promise<ActionResult<{ status: "check_email" }>> {
  const parsed = parse(forgotPasswordSchema, raw);
  if ("failure" in parsed) return parsed.failure;
  const { email } = parsed.data;

  const refused = await overLimit(deps.limiter, [
    { key: `reset:email:${email}`, limit: PASSWORD_RESET_EMAIL_LIMIT },
    { key: `reset:ip:${deps.ip}`, limit: PASSWORD_RESET_IP_LIMIT },
  ]);
  if (refused) return refused;

  try {
    await deps.auth.sendPasswordReset({ email, redirectTo: `${deps.siteUrl}/reset-password` });
  } catch (error) {
    return providerFailure(error);
  }
  return { ok: true, data: { status: "check_email" } };
}

/** Sets a new password for the person the reset link just signed in. */
export async function resetPassword(deps: Deps, raw: unknown): Promise<ActionResult> {
  const parsed = parse(newPasswordSchema, raw);
  if ("failure" in parsed) return parsed.failure;
  const { password, confirmPassword } = parsed.data;
  if (password !== confirmPassword) {
    return { ok: false, fieldErrors: { confirmPassword: MESSAGES.passwordsDiffer } };
  }

  try {
    const user = await deps.auth.getUser();
    if (!user) return { ok: false, formError: MESSAGES.signInAgain };

    const refused = await overLimit(deps.limiter, [
      { key: `password-update:user:${user.id}`, limit: PASSWORD_UPDATE_USER_LIMIT },
    ]);
    if (refused) return refused;

    await deps.auth.updatePassword(password);
  } catch (error) {
    return providerFailure(error);
  }
  return { ok: true, data: undefined };
}

export async function startGoogle(deps: Deps, next: unknown): Promise<ActionResult<{ url: string }>> {
  try {
    const { url } = await deps.auth.startGoogleSignIn({ redirectTo: confirmRedirect(deps, next) });
    return { ok: true, data: { url } };
  } catch (error) {
    return providerFailure(error);
  }
}

export async function acceptTerms(deps: Deps, raw: unknown, next: unknown): Promise<ActionResult<{ redirectTo: string }>> {
  const parsed = parse(termsSchema, raw);
  if ("failure" in parsed) return parsed.failure;

  try {
    await deps.auth.acceptTerms({ termsVersion: TERMS_VERSION });
  } catch (error) {
    return providerFailure(error);
  }
  return { ok: true, data: { redirectTo: safeNextPath(next) } };
}

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
