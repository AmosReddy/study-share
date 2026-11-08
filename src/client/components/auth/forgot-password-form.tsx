"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { FormAction } from "@/shared/form-state";
import { AuthCard, linkTarget } from "./auth-card";
import { FormMessage } from "./form-message";
import { SubmitButton } from "./submit-button";
import { EmailField } from "./text-field";
import { useAuthForm } from "./use-auth-form";
import { ErrorAnnouncer } from "./error-announcer";

/** `notice` shows above the form, for example when a reset link had expired. */
export function ForgotPasswordForm({ action, notice }: { action: FormAction; notice?: ReactNode }) {
  const { state, formAction, pending, formRef, announcerRef, onSubmit } = useAuthForm(action);
  const values = state.values ?? {};
  const backToLogin = (
    <Link href="/login" className={linkTarget}>
      Back to log in
    </Link>
  );

  if (state.status === "done") {
    return (
      <AuthCard
        title="Check your email"
        description={
          <>
            If an account uses <span className="font-medium break-all text-foreground">{values.email}</span>,
            we&apos;ve sent it a link to choose a new password. The link works once.
          </>
        }
        footer={backToLogin}
      />
    );
  }

  return (
    <AuthCard
      title="Reset your password"
      description="Enter the email you signed up with and we'll send you a link to choose a new password."
      footer={backToLogin}
    >
      <form ref={formRef} action={formAction} onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        <ErrorAnnouncer announcerRef={announcerRef} />
        {notice}
        {state.formError ? <FormMessage tone="error" title={state.formError} /> : null}
        <EmailField defaultValue={values.email} error={state.fieldErrors?.email} />
        <SubmitButton pending={pending} pendingLabel="Sending…">
          Send reset link
        </SubmitButton>
      </form>
    </AuthCard>
  );
}
