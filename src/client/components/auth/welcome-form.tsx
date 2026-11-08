"use client";

import type { FormAction } from "@/shared/form-state";
import { AuthCard } from "./auth-card";
import { FormMessage } from "./form-message";
import { SubmitButton } from "./submit-button";
import { TermsCheckbox } from "./terms-checkbox";
import { useAuthForm } from "./use-auth-form";
import { ErrorAnnouncer } from "./error-announcer";

type WelcomeFormProps = {
  action: FormAction;
  next: string;
  /** The version of the terms this page shows; the server refuses any other. */
  termsVersion: string;
  name: string;
};

/** For people who signed in with Google: the one consent box, once. */
export function WelcomeForm({ action, next, termsVersion, name }: WelcomeFormProps) {
  const { state, formAction, pending, formRef, announcerRef, onSubmit } = useAuthForm(action);

  return (
    <AuthCard
      title="One last step"
      description={
        <>
          Welcome, <span className="font-medium break-words text-foreground">{name}</span>. Before you join or create a
          group, please confirm the following.
        </>
      }
    >
      <form ref={formRef} action={formAction} onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        <ErrorAnnouncer announcerRef={announcerRef} />
        <input type="hidden" name="next" value={next} />
        <input type="hidden" name="termsVersion" value={termsVersion} />
        {state.formError ? <FormMessage tone="error" title={state.formError} /> : null}
        <TermsCheckbox defaultChecked={state.values?.acceptTerms === "on"} error={state.fieldErrors?.acceptTerms} />
        <SubmitButton pending={pending} pendingLabel="Saving…">
          Continue
        </SubmitButton>
      </form>
    </AuthCard>
  );
}
