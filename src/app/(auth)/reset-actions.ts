"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { EMAIL_SEND_COOLDOWN } from "@/server/auth/rate-limit-policy";
import { requestDeps } from "@/server/auth/request-deps";
import { clearResetEmailCookie, readResetEmailCookie, writeResetEmailCookie } from "@/server/auth/reset-cookies";
import { requestPasswordReset, setPassword, verifyResetCode } from "@/server/auth/use-cases";
import { AUTH_MESSAGES } from "@/shared/auth-messages";
import type { FormState } from "@/shared/form-state";
import { failed, text } from "./form-data";

/*
  Forgot password with an emailed code (spec 4.3): ask for a code, check it, then create a new
  password. Every reply about the address is the same for known and unknown addresses (the
  use-cases decide); the remembered address is a plain convenience cookie (reset-cookies.ts).
*/

/** Where a finished reset lands: home, which then says "Password updated" (see src/app/page.tsx). */
const PASSWORD_UPDATED_PATH = "/?password=updated";

export async function forgotPasswordAction(_state: FormState, form: FormData): Promise<FormState> {
  const values = { email: text(form, "email") };
  const result = await requestPasswordReset(await requestDeps(), values);
  // The cooldown means a code went out (or was asked for) moments ago: the code screen, with its
  // countdown, is still the right place. The cooldown answers every address the same way.
  if (!result.ok && result.formError !== AUTH_MESSAGES.justSent) return failed(result, values);
  await writeResetEmailCookie(values.email.trim().toLowerCase());
  redirect("/reset-password");
}

/** The address the code screen acts on: the remembered one, else the one typed in. */
async function resetAddress(form: FormData): Promise<string> {
  return (await readResetEmailCookie()) ?? text(form, "email");
}

export async function verifyResetCodeAction(_state: FormState, form: FormData): Promise<FormState> {
  const values = { email: text(form, "email"), code: text(form, "code") };
  const result = await verifyResetCode(await requestDeps(), { email: await resetAddress(form), code: values.code });
  if (!result.ok) return failed(result, values);
  await clearResetEmailCookie();
  redirect("/reset-password/new");
}

export async function resendResetCodeAction(_state: FormState, form: FormData): Promise<FormState> {
  const values = { email: text(form, "email") };
  const result = await requestPasswordReset(await requestDeps(), { email: await resetAddress(form) });
  if (!result.ok) return failed(result, values);
  return { status: "done", values, retryAfterSeconds: EMAIL_SEND_COOLDOWN.windowSeconds };
}

export async function changeResetEmailAction(): Promise<void> {
  await clearResetEmailCookie();
  redirect("/forgot-password");
}

/** Step 2: the new password, from the session the code opened. Other devices are signed out. */
export async function resetPasswordAction(_state: FormState, form: FormData): Promise<FormState> {
  const result = await setPassword(await requestDeps(), {
    password: text(form, "password"),
    confirmPassword: text(form, "confirmPassword"),
  });
  if (!result.ok) return failed(result, {});
  revalidatePath("/", "layout");
  // Changed, but signing out the other devices could not be confirmed: say so instead.
  if (result.data.notice) return { status: "done", notice: result.data.notice, continueTo: result.data.redirectTo };
  redirect(PASSWORD_UPDATED_PATH);
}
