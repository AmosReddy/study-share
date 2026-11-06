"use client";

import Link from "next/link";
import type { FormAction } from "@/shared/form-state";
import { AuthCard, linkTarget } from "./auth-card";
import { FormMessage } from "./form-message";
import { PasswordField } from "./password-field";
import { SubmitButton } from "./submit-button";
import { useAuthForm } from "./use-auth-form";

export function ResetPasswordForm({ action }: { action: FormAction }) {
  const { state, formAction, pending, formRef, onSubmit } = useAuthForm(action);
  const errors = state.fieldErrors ?? {};

  return (
    <AuthCard title="Choose a new password" description="Use at least 8 characters. You'll stay logged in on this device.">
      <form ref={formRef} action={formAction} onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        {state.formError ? (
          <FormMessage tone="error" title={state.formError}>
            <Link href="/forgot-password" className={linkTarget}>
              Get a new link
            </Link>
          </FormMessage>
        ) : null}
        <PasswordField label="New password" name="password" autoComplete="new-password" error={errors.password} />
        <PasswordField
          label="Confirm new password"
          name="confirmPassword"
          autoComplete="new-password"
          error={errors.confirmPassword}
        />
        <SubmitButton pending={pending} pendingLabel="Saving…">
          Save password
        </SubmitButton>
      </form>
    </AuthCard>
  );
}

/** Shown on /reset-password when no reset link signed the person in. */
export function ResetLinkExpired() {
  return (
    <AuthCard
      title="This link has expired"
      description="Reset links work once and only for a short time. Ask for a new one and use the newest email."
    >
      <Link
        href="/forgot-password"
        className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-primary px-4 text-base font-medium text-primary-foreground hover:bg-primary/80 focus-visible:ring-3 focus-visible:ring-ring/50 outline-none"
      >
        Send a new reset link
      </Link>
    </AuthCard>
  );
}
