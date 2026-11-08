"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { AUTH_MESSAGES } from "@/shared/auth-messages";
import type { FormAction } from "@/shared/form-state";
import { AuthCard, linkTarget } from "./auth-card";
import { FormMessage } from "./form-message";
import { OrDivider } from "./or-divider";
import { PasswordField } from "./password-field";
import { SubmitButton } from "./submit-button";
import { TermsCheckbox } from "./terms-checkbox";
import { EmailField, TextField } from "./text-field";
import { useAuthForm } from "./use-auth-form";

type SignupFormProps = {
  action: FormAction;
  next: string;
  loginHref: string;
  forgotHref: string;
  /** The Google button, or the in-app browser notice in its place. */
  alternative: ReactNode;
};

/** The sign-up form. On success the action opens the code screen (/signup/verify). */
export function SignupForm({ action, next, loginHref, forgotHref, alternative }: SignupFormProps) {
  const { state, formAction, pending, formRef, onSubmit } = useAuthForm(action);
  const values = state.values ?? {};
  const errors = state.fieldErrors ?? {};

  return (
    <AuthCard
      title="Create your account"
      description="Share notes and previous year papers with your class."
      footer={
        <>
          Already have an account?{" "}
          <Link href={loginHref} className={linkTarget}>
            Log in
          </Link>
        </>
      }
    >
      <form ref={formRef} action={formAction} onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        <input type="hidden" name="next" value={next} />
        {state.formError ? (
          <FormMessage tone="error" title={state.formError}>
            {state.formError === AUTH_MESSAGES.emailTaken ? (
              <span className="flex flex-wrap gap-x-4">
                <Link href={loginHref} className={linkTarget}>
                  Log in
                </Link>
                <Link href={forgotHref} className={linkTarget}>
                  Forgot your password?
                </Link>
              </span>
            ) : null}
          </FormMessage>
        ) : null}
        <TextField
          label="Name"
          name="displayName"
          autoComplete="name"
          hint="Shown to people in your groups."
          defaultValue={values.displayName}
          error={errors.displayName}
        />
        <EmailField defaultValue={values.email} error={errors.email} />
        <PasswordField label="Password" name="password" autoComplete="new-password" hint="At least 8 characters." error={errors.password} />
        <TermsCheckbox defaultChecked={values.acceptTerms === "on"} error={errors.acceptTerms} />
        <SubmitButton pending={pending} pendingLabel="Creating account…">
          Create account
        </SubmitButton>
      </form>
      <OrDivider />
      {alternative}
    </AuthCard>
  );
}
