"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requestDeps } from "@/server/auth/request-deps";
import {
  acceptTerms,
  CONFIRM_EMAIL_CODE,
  logIn,
  logOut,
  requestPasswordReset,
  setPassword,
  startGoogle,
  updateProfile,
} from "@/server/auth/use-cases";
import { getCurrentUser } from "@/server/auth/session";
import { getAuthProvider } from "@/server/services";
import type { FormState } from "@/shared/form-state";
import { safeNextPath } from "@/shared/safe-next-path";
import { failed, text } from "./form-data";

/*
  Thin server actions: read the form, call the use-case, turn its result into what the
  screen shows. Validation, rate limits and neutral replies all live in the use-cases.
  Passwords are never echoed back. The sign-up and code screen actions are in
  signup-actions.ts.
*/

export async function logInAction(_state: FormState, form: FormData): Promise<FormState> {
  const values = { email: text(form, "email") };
  const result = await logIn(await requestDeps(), { email: values.email, password: text(form, "password") }, text(form, "next"));
  if (!result.ok) {
    if (result.formError === CONFIRM_EMAIL_CODE) {
      return { status: "error", needsConfirmation: true, values: { email: values.email.trim() } };
    }
    return failed(result, values);
  }
  redirect(result.data.redirectTo);
}

/*
  Forgot password and reset: Task 6 replaces these two screens with the code flow. Until then
  the request already sends a recovery CODE (the link methods are gone) and the reset screen
  sets a password for whoever holds a code session.
*/

export async function forgotPasswordAction(_state: FormState, form: FormData): Promise<FormState> {
  const values = { email: text(form, "email") };
  const result = await requestPasswordReset(await requestDeps(), values);
  if (!result.ok) return failed(result, values);
  return { status: "done", values: { email: values.email.trim() } };
}

export async function resetPasswordAction(_state: FormState, form: FormData): Promise<FormState> {
  const result = await setPassword(await requestDeps(), {
    password: text(form, "password"),
    confirmPassword: text(form, "confirmPassword"),
  });
  if (!result.ok) return failed(result, {});
  redirect(result.data.redirectTo);
}

export async function startGoogleAction(_state: FormState, form: FormData): Promise<FormState> {
  // Google returns to /auth/callback, which finishes sign-in and then goes on to `next`.
  const next = safeNextPath(text(form, "next"));
  const result = await startGoogle(await requestDeps(), `/auth/callback?next=${encodeURIComponent(next)}`);
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
  const result = await acceptTerms(await requestDeps(), raw, text(form, "next"));
  if (!result.ok) return failed(result, values);
  redirect(result.data.redirectTo);
}

export async function updateProfileAction(_state: FormState, form: FormData): Promise<FormState> {
  // The page requires sign-in, but a stale tab can still post here after the session ended.
  if (!(await getCurrentUser())) redirect("/login?next=%2Faccount");
  const values = { displayName: text(form, "displayName") };
  const result = await updateProfile(await requestDeps(), values);
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
