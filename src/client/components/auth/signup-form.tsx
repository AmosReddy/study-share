"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { FormAction } from "@/shared/form-state";
import { AuthCard } from "./auth-card";
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
  /** The Google button, or the in-app browser notice in its place. */
  alternative: ReactNode;
};

export function SignupForm({ action, next, loginHref, alternative }: SignupFormProps) {
  const { state, formAction, pending, formRef, onSubmit } = useAuthForm(action);
  const values = state.values ?? {};
  const errors = state.fieldErrors ?? {};

  if (state.status === "done") {
    return (
      <AuthCard
        title="Check your email"
        description={
          <>
            If <span className="font-medium break-all text-foreground">{values.email}</span> is new to study-share,
            we&apos;ve sent it a link. Open the link to confirm your address and finish signing up.
          </>
        }
        footer={
          <>
            Nothing after a few minutes? Check your spam folder, or{" "}
            <Link href={loginHref} className="font-medium text-foreground underline underline-offset-4">
              log in
            </Link>{" "}
            if you already have an account.
          </>
        }
      />
    );
  }

  return (
    <AuthCard
      title="Create your account"
      description="Share notes and previous year papers with your class."
      footer={
        <>
          Already have an account?{" "}
          <Link href={loginHref} className="font-medium text-foreground underline underline-offset-4">
            Log in
          </Link>
        </>
      }
    >
      <form ref={formRef} action={formAction} onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        <input type="hidden" name="next" value={next} />
        {state.formError ? <FormMessage tone="error" title={state.formError} /> : null}
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
