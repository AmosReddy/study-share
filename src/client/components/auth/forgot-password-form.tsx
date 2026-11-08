"use client";

import Link from "next/link";
import type { FormAction } from "@/shared/form-state";
import { AuthCard, linkTarget } from "./auth-card";
import { ErrorAnnouncer } from "./error-announcer";
import { FormMessage } from "./form-message";
import { SubmitButton } from "./submit-button";
import { EmailField } from "./text-field";
import { useAuthForm } from "./use-auth-form";

/**
 * Forgot password (spec 4.3): the address. On success the action opens the code screen
 * (/reset-password), whose reply is the same for every address.
 */
export function ForgotPasswordForm({ action }: { action: FormAction }) {
  const { state, formAction, pending, formRef, announcerRef, onSubmit } = useAuthForm(action);
  const values = state.values ?? {};

  return (
    <AuthCard
      title="Reset your password"
      description="Enter the email you signed up with. We'll send you a code to choose a new password."
      footer={
        <Link href="/login" className={linkTarget}>
          Back to log in
        </Link>
      }
    >
      <form ref={formRef} action={formAction} onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        <ErrorAnnouncer announcerRef={announcerRef} />
        {state.formError ? <FormMessage tone="error" title={state.formError} /> : null}
        <EmailField defaultValue={values.email} error={state.fieldErrors?.email} autoFocus />
        <SubmitButton pending={pending} pendingLabel="Sending…">
          Send code
        </SubmitButton>
      </form>
    </AuthCard>
  );
}
