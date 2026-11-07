"use client";

import { startTransition, useActionState, useEffect, useRef, type FormEvent } from "react";
import { IDLE, type FormAction } from "@/shared/form-state";

/**
 * Runs a form through its server action. With JavaScript, the submit goes through a
 * transition so React does not clear what was typed; without it, the form posts to
 * the same action and the page comes back with the echoed values. After a failed
 * submit, focus moves to the first field marked invalid.
 */
export function useAuthForm(action: FormAction) {
  const [state, formAction, pending] = useActionState(action, IDLE);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status !== "error") return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [state]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  }

  return { state, formAction, pending, formRef, onSubmit };
}
