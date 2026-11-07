"use client";

import type { FormAction } from "@/shared/form-state";
import { AuthCard } from "./auth-card";
import { FormMessage } from "./form-message";
import { SubmitButton } from "./submit-button";
import { TextField } from "./text-field";
import { useAuthForm } from "./use-auth-form";

type AccountFormProps = {
  action: FormAction;
  /** A server action that signs the person out and redirects to `/`, or returns the reason it could not. */
  logOutAction: FormAction;
  name: string;
  email: string;
};

/** The account page: change the display name, see the email (read-only), log out. */
export function AccountForm({ action, logOutAction, name, email }: AccountFormProps) {
  const { state, formAction, pending, formRef, onSubmit } = useAuthForm(action);
  const {
    state: logOutState,
    formAction: logOutFormAction,
    pending: logOutPending,
    formRef: logOutRef,
    onSubmit: onLogOutSubmit,
  } = useAuthForm(logOutAction);
  // What was typed is kept after an error; after a save, the saved (trimmed) name is shown.
  const shown = state.values?.displayName ?? name;

  return (
    <AuthCard title="Account" description="How you appear to people in your groups.">
      <form ref={formRef} action={formAction} onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        {state.formError ? <FormMessage tone="error" title={state.formError} /> : null}
        {state.status === "done" ? <FormMessage tone="success" title="Your name has been saved." /> : null}
        <TextField
          key={`${state.status}:${shown}`}
          label="Name"
          name="displayName"
          autoComplete="name"
          hint="Shown to people in your groups."
          defaultValue={shown}
          error={state.fieldErrors?.displayName}
        />
        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-medium">Email</p>
          <p className="min-h-11 py-2.5 text-base break-all">{email}</p>
          <p className="text-sm text-muted-foreground">You log in with this address. It cannot be changed here.</p>
        </div>
        <SubmitButton pending={pending} pendingLabel="Saving…">
          Save
        </SubmitButton>
      </form>

      <form
        ref={logOutRef}
        action={logOutFormAction}
        onSubmit={onLogOutSubmit}
        className="mt-8 flex flex-col gap-4 border-t pt-6"
      >
        {logOutState.formError ? <FormMessage tone="error" title={logOutState.formError} /> : null}
        <SubmitButton variant="outline" pending={logOutPending} pendingLabel="Logging out…">
          Log out
        </SubmitButton>
      </form>
    </AuthCard>
  );
}
