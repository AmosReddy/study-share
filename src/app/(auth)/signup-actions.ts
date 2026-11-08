"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { EMAIL_SEND_COOLDOWN } from "@/server/auth/rate-limit-policy";
import { requestDeps } from "@/server/auth/request-deps";
import { getCurrentUser } from "@/server/auth/session";
import {
  clearSignupCookies,
  readPendingSignupCookie,
  writePendingSignupCookie,
  writeSignupEmailCookie,
} from "@/server/auth/signup-cookies";
import { resendSignUpCode, setPassword, signUp, verifySignUpCode } from "@/server/auth/use-cases";
import { AUTH_MESSAGES } from "@/shared/auth-messages";
import type { FormState } from "@/shared/form-state";
import { safeNextPath } from "@/shared/safe-next-path";
import { failed, text } from "./form-data";
import { withNext } from "./page-params";

/*
  Email sign-up with a code (spec 4.1, 5.1): the form, the code screen and the forced
  "create your password" step. The pending user's id goes into the signed cookie only: it is
  never returned to the screen.
*/

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
  const next = safeNextPath(text(form, "next"));
  const result = await signUp(await requestDeps(), raw, next);
  if (!result.ok) return failed(result, values);
  await writePendingSignupCookie({ userId: result.data.pendingUserId, email: result.data.email });
  redirect(withNext("/signup/verify", next));
}

export async function verifyCodeAction(_state: FormState, form: FormData): Promise<FormState> {
  const next = safeNextPath(text(form, "next"));
  const pending = await readPendingSignupCookie();

  // A repeat submit after the code already signed this person in (double tap, back button,
  // a second tab): go on instead of reporting the used code as wrong.
  const user = await getCurrentUser();
  if (user && (pending === null || pending.userId === user.id)) {
    await clearSignupCookies();
    redirect(next);
  }

  const values = { email: text(form, "email"), code: text(form, "code") };
  const result = await verifySignUpCode(await requestDeps(pending), values, next);
  if (!result.ok) {
    // The address is confirmed but no session could be opened: the cookie is of no further use.
    if (result.formError === AUTH_MESSAGES.confirmedSetPassword) await clearSignupCookies();
    return failed(result, values);
  }
  await clearSignupCookies();
  redirect(result.data.needsPassword ? withNext("/signup/password", result.data.redirectTo) : result.data.redirectTo);
}

export async function resendCodeAction(_state: FormState, form: FormData): Promise<FormState> {
  const values = { email: text(form, "email") };
  // With the cookie the use-case sends to the cookie's address; the typed one is for no cookie.
  const result = await resendSignUpCode(await requestDeps(await readPendingSignupCookie()), values);
  if (!result.ok) return failed(result, values);
  return { status: "done", values, retryAfterSeconds: EMAIL_SEND_COOLDOWN.windowSeconds };
}

export async function changeEmailAction(form: FormData): Promise<void> {
  await clearSignupCookies();
  redirect(withNext("/signup", safeNextPath(text(form, "next"))));
}

/**
 * The log-in page's "send a new code" for an address that is not confirmed yet. It cannot
 * prove which pending account is this person's (the log-in use-case returns no id), so it sets
 * no signed cookie: the code screen asks for the address (pre-filled) and a code from it then
 * takes the one-step password path of spec 5.1.
 */
export async function sendNewCodeAction(_state: FormState, form: FormData): Promise<FormState> {
  const values = { email: text(form, "email") };
  const result = await resendSignUpCode(await requestDeps(), values);
  // The cooldown means an email went out moments ago: the code screen is still the right place.
  if (!result.ok && result.formError !== AUTH_MESSAGES.justSent) return failed(result, values);
  await writeSignupEmailCookie(values.email.trim().toLowerCase());
  redirect(withNext("/signup/verify", safeNextPath(text(form, "next"))));
}

export async function setPasswordAction(_state: FormState, form: FormData): Promise<FormState> {
  const result = await setPassword(
    await requestDeps(),
    { password: text(form, "password"), confirmPassword: text(form, "confirmPassword") },
    text(form, "next"),
  );
  if (!result.ok) return failed(result, {});
  revalidatePath("/", "layout");
  if (result.data.notice) return { status: "done", notice: result.data.notice, continueTo: result.data.redirectTo };
  redirect(result.data.redirectTo);
}
