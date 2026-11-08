"use client";

import { startTransition, useActionState, useEffect, useRef, type FormEvent } from "react";
import { IDLE, type FormAction } from "@/shared/form-state";

/** The text of a field's error, from the `<id>-error` element its aria-describedby names. */
function fieldErrorText(field: HTMLElement): string {
  const ids = (field.getAttribute("aria-describedby") ?? "").split(/\s+/).filter((id) => id.endsWith("-error"));
  return ids
    .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
    .filter(Boolean)
    .join(" ");
}

/**
 * Runs a form through its server action. With JavaScript, the submit goes through a
 * transition so React does not clear what was typed; without it, the form posts to
 * the same action and the page comes back with the echoed values.
 *
 * After a failed submit the first field marked invalid gets the person's attention, and its
 * error is said exactly once:
 * - focus elsewhere (a tapped button): focus moves to the field, and the screen reader reads
 *   its label and error (aria-describedby);
 * - focus already in that field (Enter or Go on the keyboard): focusing it again says
 *   nothing, so the error is put into the form's live region (`announcerRef`, rendered with
 *   ErrorAnnouncer) instead. The region is emptied on every new answer, so each failed attempt
 *   is announced again and a stale message never lingers.
 */
export function useAuthForm(action: FormAction) {
  const [state, formAction, pending] = useActionState(action, IDLE);
  const formRef = useRef<HTMLFormElement>(null);
  const announcerRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const announcer = announcerRef.current;
    if (announcer) announcer.textContent = "";
    if (state.status !== "error") return;
    const field = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    if (!field) return;
    if (field !== document.activeElement) {
      field.focus();
      return;
    }
    const message = fieldErrorText(field);
    if (!announcer || !message) return;
    // Filled in a moment after being emptied, so screen readers see a change to announce.
    const timer = setTimeout(() => {
      announcer.textContent = message;
    }, 50);
    return () => clearTimeout(timer);
  }, [state]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  }

  return { state, formAction, pending, formRef, announcerRef, onSubmit };
}
