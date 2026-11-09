"use client";

import { useLayoutEffect, useState } from "react";
import { ErrorAnnouncer } from "@/client/components/auth/error-announcer";
import { FormMessage } from "@/client/components/auth/form-message";
import { PasswordField } from "@/client/components/auth/password-field";
import { SubmitButton } from "@/client/components/auth/submit-button";
import { TextField } from "@/client/components/auth/text-field";
import { useAuthForm } from "@/client/components/auth/use-auth-form";
import type { FormAction, FormState } from "@/shared/form-state";
import { retryHint } from "@/shared/group-messages";
import type { JoinMode } from "@/shared/groups";

/** The form's message, with when to try again for a refusal that has a wait (locked, too many). */
function FormError({ state }: { state: FormState }) {
  if (!state.formError) return null;
  return (
    <FormMessage tone="error" title={state.formError}>
      {state.retryAfterSeconds ? retryHint(state.retryAfterSeconds) : null}
    </FormMessage>
  );
}

type JoinGroupFormProps = {
  action: FormAction;
  /** The invite link token or group code from the page's address. */
  inviteKey: string;
  joinMode: JoinMode;
  ownerName: string;
};

/**
 * Join on the invite page: one button for a link-only group, the group password and the button
 * for a password group. Next keeps a page's state when the person navigates away (Activity), so
 * the form starts over as soon as it is hidden: a typed password never waits on a page left behind.
 */
export function JoinGroupForm(props: JoinGroupFormProps) {
  const [round, setRound] = useState(0);
  useLayoutEffect(() => () => setRound((value) => value + 1), []);
  return <JoinGroupFields key={round} {...props} />;
}

function JoinGroupFields({ action, inviteKey, joinMode, ownerName }: JoinGroupFormProps) {
  const { state, formAction, pending, formRef, announcerRef, onSubmit } = useAuthForm(action);
  const errors = state.fieldErrors ?? {};

  return (
    <form ref={formRef} action={formAction} onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <ErrorAnnouncer announcerRef={announcerRef} />
      <input type="hidden" name="key" value={inviteKey} />
      <FormError state={state} />
      {joinMode === "password" ? (
        <PasswordField
          label="Group password"
          name="password"
          autoComplete="off"
          autoCorrect="off"
          hint={ownerName ? `Ask ${ownerName} for the group password.` : "Ask the group owner for the group password."}
          error={errors.password}
        />
      ) : null}
      <SubmitButton pending={pending} pendingLabel="Joining…">
        Join
      </SubmitButton>
    </form>
  );
}

/** Join by code: the code is typed in any case, with or without the hyphen or spaces. */
export function FindGroupForm({ action }: { action: FormAction }) {
  const { state, formAction, pending, formRef, announcerRef, onSubmit } = useAuthForm(action);
  const values = state.values ?? {};
  const errors = state.fieldErrors ?? {};

  return (
    <form ref={formRef} action={formAction} onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <ErrorAnnouncer announcerRef={announcerRef} />
      <FormError state={state} />
      <TextField
        label="Group code"
        name="code"
        id="join-code"
        type="text"
        inputMode="text"
        autoComplete="off"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        maxLength={32}
        hint="8 letters and numbers, from the person who made the group. For example, ABCD-2345."
        defaultValue={values.code}
        error={errors.code}
        className="font-mono tracking-wider uppercase"
      />
      <SubmitButton pending={pending} pendingLabel="Finding…">
        Find group
      </SubmitButton>
    </form>
  );
}
