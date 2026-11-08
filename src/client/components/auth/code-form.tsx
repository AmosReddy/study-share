"use client";

import { useEffect, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import { Button } from "@/client/components/ui/button";
import { cn } from "@/client/lib/utils";
import { AUTH_MESSAGES } from "@/shared/auth-messages";
import { CODE_LENGTH } from "@/shared/auth-schemas";
import { ErrorAnnouncer } from "./error-announcer";
import { FormMessage } from "./form-message";
import { SubmitButton } from "./submit-button";
import { describedBy, EmailField, FieldError, inputClassName } from "./text-field";

/** Room for a code pasted with separators: "123 456", "123-456", "12 34 56", " 123 - 456 ". */
const CODE_MAX_LENGTH = CODE_LENGTH * 2;

/** Form-level messages that are about the code itself, so they are shown on (and focus) the code box. */
const CODE_MESSAGES: readonly string[] = [AUTH_MESSAGES.codeInvalid, AUTH_MESSAGES.tooManyCodes];

type CodeFormProps = {
  /** The address the code went to (shown in the card). Null: the form asks for it above the code box. */
  email: string | null;
  /** Without `email`: a value to pre-fill the address field with. */
  defaultEmail?: string;
  next: string;
  /** The verify form: from useAuthForm. */
  action: (formData: FormData) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  formRef: RefObject<HTMLFormElement | null>;
  /** The live region for an error that focus cannot announce: from useAuthForm. */
  announcerRef: RefObject<HTMLParagraphElement | null>;
  pending: boolean;
  values?: Record<string, string>;
  fieldErrors?: Record<string, string>;
  formError?: string;
  /** Asks for a new code. Disabled while the countdown runs or a request is on its way. */
  onResend: () => void;
  resendPending: boolean;
  /** Seconds the Resend countdown starts from, each time `cooldownKey` changes. */
  cooldownSeconds: number;
  cooldownKey: unknown;
  /** The reply to the last Resend (sent, or why not). */
  resendMessage?: ReactNode;
  /** The "Change email" control (a form button or a link). */
  changeEmail: ReactNode;
};

/**
 * The emailed-code box, shared by sign-up and password reset. Presentational: the caller owns
 * the actions. The code box is large and centred, opens the numeric keypad, offers one-tap
 * autofill of the code from the email, and accepts pasted codes with spaces or dashes (the
 * server drops them). Verify comes straight after it, so it stays above a phone keyboard.
 */
export function CodeForm({
  email,
  defaultEmail,
  next,
  action,
  onSubmit,
  formRef,
  announcerRef,
  pending,
  values = {},
  fieldErrors = {},
  formError,
  onResend,
  resendPending,
  cooldownSeconds,
  cooldownKey,
  resendMessage,
  changeEmail,
}: CodeFormProps) {
  const remaining = useCountdown(cooldownSeconds, cooldownKey);
  const codeError = fieldErrors.code ?? (formError && CODE_MESSAGES.includes(formError) ? formError : undefined);
  const otherError = formError && formError !== codeError ? formError : undefined;

  return (
    <>
      <form ref={formRef} action={action} onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        <ErrorAnnouncer announcerRef={announcerRef} />
        <input type="hidden" name="next" value={next} />
        {otherError ? <FormMessage tone="error" title={otherError} /> : null}
        {email === null ? (
          <EmailField defaultValue={values.email ?? defaultEmail} error={fieldErrors.email} autoFocus={!defaultEmail} />
        ) : null}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="code" className="text-sm font-medium">
            Code
          </label>
          <input
            id="code"
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={CODE_MAX_LENGTH}
            // The person arrives here to type the code: open the keypad straight away.
            autoFocus={email !== null || Boolean(defaultEmail)}
            defaultValue={values.code}
            aria-invalid={codeError ? true : undefined}
            aria-describedby={describedBy("code", undefined, codeError)}
            className={cn(inputClassName, "h-14 text-center font-mono text-2xl tracking-[0.3em] tabular-nums")}
          />
          {codeError ? <FieldError id="code-error">{codeError}</FieldError> : null}
        </div>
        <SubmitButton pending={pending} pendingLabel="Verifying…">
          Verify
        </SubmitButton>
      </form>

      <div className="mt-6 flex flex-col gap-3">
        {resendMessage}
        <Button
          type="button"
          variant="outline"
          onClick={onResend}
          disabled={remaining > 0 || resendPending}
          className="h-11 w-full text-base tabular-nums"
        >
          {resendPending ? "Sending…" : remaining > 0 ? `Resend code in ${clock(remaining)}` : "Resend code"}
        </Button>
        {changeEmail}
        <p className="text-sm text-muted-foreground">Nothing yet? Check your spam folder.</p>
      </div>
    </>
  );
}

/** 75 as "1:15". */
function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * Whole seconds left of a countdown that (re)starts from `seconds` whenever `key` changes.
 * It ticks against the clock, so a sleeping tab catches up when it wakes.
 */
function useCountdown(seconds: number, key: unknown): number {
  const [state, setState] = useState({ key, remaining: seconds });
  if (state.key !== key) setState({ key, remaining: seconds });

  useEffect(() => {
    if (seconds <= 0) return;
    const deadline = Date.now() + seconds * 1000;
    const timer = setInterval(() => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setState((current) => (current.remaining === left ? current : { ...current, remaining: left }));
      if (left === 0) clearInterval(timer);
    }, 250);
    return () => clearInterval(timer);
  }, [seconds, key]);

  return state.key === key ? state.remaining : seconds;
}
