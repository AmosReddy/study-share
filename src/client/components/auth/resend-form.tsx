"use client";

import type { FormAction } from "@/shared/form-state";
import { FormMessage } from "./form-message";
import { SubmitButton } from "./submit-button";
import { EmailField } from "./text-field";
import { useAuthForm } from "./use-auth-form";

type ResendFormProps = {
  action: FormAction;
  next: string;
  /** Known address: sent hidden, so the form is one button. Otherwise the person types it. */
  email?: string;
  buttonLabel: string;
};

/**
 * Asks for a new sign-up code for an address that is not confirmed yet; the action then opens
 * the code screen. The reply is the same whether or not a code was sent.
 */
export function ResendForm({ action, next, email, buttonLabel }: ResendFormProps) {
  const { state, formAction, pending, formRef, onSubmit } = useAuthForm(action);

  return (
    <form ref={formRef} action={formAction} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />
      {email === undefined ? (
        <EmailField id="resend-email" defaultValue={state.values?.email} error={state.fieldErrors?.email} />
      ) : (
        <input type="hidden" name="email" value={email} />
      )}
      {state.formError ? <FormMessage tone="error" title={state.formError} /> : null}
      <SubmitButton variant="outline" pending={pending} pendingLabel="Sending…">
        {buttonLabel}
      </SubmitButton>
    </form>
  );
}
