"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { FormAction } from "@/shared/form-state";
import { AuthCard, linkTarget } from "./auth-card";
import { FormMessage } from "./form-message";
import { OrDivider } from "./or-divider";
import { PasswordField } from "./password-field";
import { ResendForm } from "./resend-form";
import { SubmitButton } from "./submit-button";
import { EmailField } from "./text-field";
import { useAuthForm } from "./use-auth-form";

type LoginFormProps = {
  action: FormAction;
  resendAction: FormAction;
  next: string;
  signupHref: string;
  forgotHref: string;
  /** The Google button, or the in-app browser notice in its place. */
  alternative: ReactNode;
  /** A message above the form, for example about an expired link. */
  notice?: ReactNode;
};

export function LoginForm({ action, resendAction, next, signupHref, forgotHref, alternative, notice }: LoginFormProps) {
  const { state, formAction, pending, formRef, onSubmit } = useAuthForm(action);
  const values = state.values ?? {};
  const errors = state.fieldErrors ?? {};

  return (
    <AuthCard
      title="Log in"
      description="Welcome back."
      footer={
        <>
          New here?{" "}
          <Link href={signupHref} className={linkTarget}>
            Create an account
          </Link>
        </>
      }
    >
      {notice ? (
        <>
          {notice}
          <OrDivider label="or log in" />
        </>
      ) : null}

      {state.needsConfirmation ? (
        <div className="mb-6 flex flex-col gap-3">
          <FormMessage tone="info" title="Confirm your email to log in">
            We sent a link to <span className="font-medium break-all">{values.email}</span> when you signed up. Open
            it, or ask for a new one.
          </FormMessage>
          <ResendForm action={resendAction} next={next} email={values.email} buttonLabel="Resend confirmation email" />
        </div>
      ) : null}

      <form ref={formRef} action={formAction} onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        <input type="hidden" name="next" value={next} />
        {state.formError ? <FormMessage tone="error" title={state.formError} /> : null}
        <EmailField defaultValue={values.email} error={errors.email} />
        <div className="flex flex-col gap-1">
          <PasswordField label="Password" name="password" autoComplete="current-password" error={errors.password} />
          <Link
            href={forgotHref}
            className="inline-flex min-h-11 items-center self-start text-sm font-medium underline-offset-4 hover:underline"
          >
            Forgot your password?
          </Link>
        </div>
        <SubmitButton pending={pending} pendingLabel="Logging in…">
          Log in
        </SubmitButton>
      </form>
      <OrDivider />
      {alternative}
    </AuthCard>
  );
}
