"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  acceptTerms,
  CONFIRM_EMAIL_CODE,
  logIn,
  logOut,
  requestPasswordResetLink,
  resendConfirmation,
  resetPassword,
  signUpWithLink,
  startGoogle,
  type ActionResult,
  updateProfile,
  type Deps,
} from "@/server/auth/use-cases";
import { getCurrentUser } from "@/server/auth/session";
import { clientIp } from "@/server/request-ip";
import { getAccountDirectory, getAuthProvider, getRateLimiter } from "@/server/services";
import { getSiteUrl } from "@/server/site-url";
import type { FormState } from "@/shared/form-state";
import { safeNextPath } from "@/shared/safe-next-path";

/*
  Thin server actions: read the form, call the use-case, turn its result into what the
  screen shows. Validation, rate limits and neutral replies all live in the use-cases.
  Passwords are never echoed back.
*/

async function deps(): Promise<Deps> {
  const [auth, requestHeaders] = await Promise.all([getAuthProvider(), headers()]);
  return {
    auth,
    limiter: getRateLimiter(),
    siteUrl: getSiteUrl(),
    ip: clientIp(requestHeaders.get("x-forwarded-for")),
    directory: getAccountDirectory(),
    // Task 5 reads the pending sign-up cookie here (readPendingSignup); the link flow below ignores it.
    pending: null,
  };
}

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

function failed(result: Extract<ActionResult<unknown>, { ok: false }>, values: Record<string, string>): FormState {
  return { status: "error", fieldErrors: result.fieldErrors, formError: result.formError, values };
}

export async function signUpAction(_state: FormState, form: FormData): Promise<FormState> {
  const values = {
    displayName: text(form, "displayName"),
    email: text(form, "email"),
    acceptTerms: text(form, "acceptTerms"),
  };
  const raw = {
    displayName: values.displayName,
    email: values.email,
    password: text(form, "password"),
    acceptTerms: values.acceptTerms === "on",
  };
  const result = await signUpWithLink(await deps(), raw, text(form, "next"));
  if (!result.ok) return failed(result, values);
  return { status: "done", values: { email: values.email.trim() } };
}

export async function logInAction(_state: FormState, form: FormData): Promise<FormState> {
  const values = { email: text(form, "email") };
  const result = await logIn(await deps(), { email: values.email, password: text(form, "password") }, text(form, "next"));
  if (!result.ok) {
    if (result.formError === CONFIRM_EMAIL_CODE) {
      return { status: "error", needsConfirmation: true, values: { email: values.email.trim() } };
    }
    return failed(result, values);
  }
  redirect(result.data.redirectTo);
}

export async function resendConfirmationAction(_state: FormState, form: FormData): Promise<FormState> {
  const values = { email: text(form, "email") };
  const result = await resendConfirmation(await deps(), values, text(form, "next"));
  if (!result.ok) return failed(result, values);
  return { status: "done" };
}

export async function forgotPasswordAction(_state: FormState, form: FormData): Promise<FormState> {
  const values = { email: text(form, "email") };
  const result = await requestPasswordResetLink(await deps(), values);
  if (!result.ok) return failed(result, values);
  return { status: "done", values: { email: values.email.trim() } };
}

export async function resetPasswordAction(_state: FormState, form: FormData): Promise<FormState> {
  const result = await resetPassword(await deps(), {
    password: text(form, "password"),
    confirmPassword: text(form, "confirmPassword"),
  });
  if (!result.ok) return failed(result, {});
  redirect("/");
}

export async function startGoogleAction(_state: FormState, form: FormData): Promise<FormState> {
  // Google returns to /auth/callback, which finishes sign-in and then goes on to `next`.
  const next = safeNextPath(text(form, "next"));
  const result = await startGoogle(await deps(), `/auth/callback?next=${encodeURIComponent(next)}`);
  if (!result.ok) return failed(result, {});
  // Google's address is on another site, so redirect() sends the browser there. A same-site
  // address (only the test-mode fake Google) would instead be followed inside the server,
  // and the session cookie set at /auth/callback would never reach the browser. So the
  // page loads that one itself.
  if (result.data.url.startsWith("/")) return { status: "done", navigateTo: result.data.url };
  redirect(result.data.url);
}

export async function acceptTermsAction(_state: FormState, form: FormData): Promise<FormState> {
  const values = { acceptTerms: text(form, "acceptTerms") };
  const raw = { acceptTerms: values.acceptTerms === "on", termsVersion: text(form, "termsVersion") };
  const result = await acceptTerms(await deps(), raw, text(form, "next"));
  if (!result.ok) return failed(result, values);
  redirect(result.data.redirectTo);
}

export async function updateProfileAction(_state: FormState, form: FormData): Promise<FormState> {
  // The page requires sign-in, but a stale tab can still post here after the session ended.
  if (!(await getCurrentUser())) redirect("/login?next=%2Faccount");
  const values = { displayName: text(form, "displayName") };
  const result = await updateProfile(await deps(), values);
  if (!result.ok) return failed(result, values);
  // The name is shown in the shell header of every page, so refresh them all.
  revalidatePath("/", "layout");
  return { status: "done", values: { displayName: values.displayName.trim() } };
}

/**
 * Signs out and goes to `/`. When the provider fails, nothing redirects: the person may still be
 * signed in, so the screen gets the message and shows it.
 */
export async function logOutAction(): Promise<FormState> {
  const result = await logOut({ auth: await getAuthProvider() });
  if (!result.ok) return failed(result, {});
  revalidatePath("/", "layout");
  redirect("/");
}
