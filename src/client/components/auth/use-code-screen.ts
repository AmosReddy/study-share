"use client";

import { startTransition, useActionState, useEffect, useRef, type FormEvent } from "react";
import { IDLE, type FormAction } from "@/shared/form-state";
import { useAuthForm } from "./use-auth-form";

/**
 * The wiring shared by the two code screens (sign-up and password reset) around CodeForm: the
 * verify form (useAuthForm, so errors are announced), a guard that sends one code check at a
 * time, and the Resend action with where its countdown starts.
 */
export function useCodeScreen(verifyAction: FormAction, resendAction: FormAction, cooldownSeconds: number) {
  const form = useAuthForm(verifyAction);
  const { state, formRef, onSubmit } = form;
  const [resendState, resendFormAction, resendPending] = useActionState(resendAction, IDLE);

  // One code check at a time: a double tap must not send the code twice (the second would find
  // it used). Released when an answer comes back; a success navigates away.
  const checking = useRef(false);
  useEffect(() => {
    checking.current = false;
  }, [state]);
  function submitOnce(event: FormEvent<HTMLFormElement>) {
    if (checking.current) {
      event.preventDefault();
      return;
    }
    checking.current = true;
    onSubmit(event);
  }

  function resend() {
    const data = new FormData();
    // Only used without a remembered address; with one the server sends to that address.
    data.set("email", formRef.current?.querySelector<HTMLInputElement>('input[name="email"]')?.value ?? "");
    startTransition(() => resendFormAction(data));
  }

  return {
    ...form,
    submitOnce,
    resend,
    resendState,
    resendPending,
    /** Seconds the Resend countdown starts from: the page's value until the first resend answers. */
    cooldown: resendState.status === "idle" ? cooldownSeconds : (resendState.retryAfterSeconds ?? 0),
    /** The address field's error can come from either form. */
    fieldErrors: { ...(resendState.fieldErrors ?? {}), ...(state.fieldErrors ?? {}) },
  };
}
