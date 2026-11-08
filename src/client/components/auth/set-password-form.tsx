"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { AUTH_MESSAGES } from "@/shared/auth-messages";
import type { FormAction } from "@/shared/form-state";
import { AuthCard, linkTarget } from "./auth-card";
import { FormMessage } from "./form-message";
import { PasswordField } from "./password-field";
import { SubmitButton } from "./submit-button";
import { useAuthForm } from "./use-auth-form";
import { ErrorAnnouncer } from "./error-announcer";

type SetPasswordFormProps = {
  action: FormAction;
  next: string;
  title: string;
  description: ReactNode;
  /** The signed-in account's address, so password managers save the new password for it. */
  accountEmail: string;
  /** Where to go when the session has ended (a new code is needed). */
  recovery: { href: string; label: string };
};

/**
 * "Create a password" after a code: the forced step of spec 5.1, and (Task 6) the second step
 * of a password reset. Show/hide on both fields, `new-password` for password managers.
 */
export function SetPasswordForm({ action, next, title, description, accountEmail, recovery }: SetPasswordFormProps) {
  const { state, formAction, pending, formRef, announcerRef, onSubmit } = useAuthForm(action);
  const errors = state.fieldErrors ?? {};

  if (state.status === "done" && state.notice) {
    return (
      <AuthCard title={title}>
        <div className="flex flex-col gap-4">
          <FormMessage tone="info" title={state.notice} />
          <Link href={state.continueTo ?? "/"} className={linkTarget}>
            Continue
          </Link>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={title} description={description}>
      <form ref={formRef} action={formAction} onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        <ErrorAnnouncer announcerRef={announcerRef} />
        <input type="hidden" name="next" value={next} />
        {/* Lets password managers file the new password under this account. */}
        <input type="email" name="username" autoComplete="username" value={accountEmail} readOnly hidden />
        {state.formError ? (
          <FormMessage tone="error" title={state.formError}>
            {state.formError === AUTH_MESSAGES.sessionEnded ? (
              <Link href={recovery.href} className={linkTarget}>
                {recovery.label}
              </Link>
            ) : null}
          </FormMessage>
        ) : null}
        <PasswordField
          label="New password"
          name="password"
          autoComplete="new-password"
          hint="At least 8 characters."
          error={errors.password}
        />
        <PasswordField label="Confirm new password" name="confirmPassword" autoComplete="new-password" error={errors.confirmPassword} />
        <SubmitButton pending={pending} pendingLabel="Saving…">
          Save password
        </SubmitButton>
      </form>
    </AuthCard>
  );
}
