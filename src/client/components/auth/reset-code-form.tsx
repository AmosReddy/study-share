"use client";

import Link from "next/link";
import { AUTH_MESSAGES } from "@/shared/auth-messages";
import { CODE_LENGTH } from "@/shared/auth-schemas";
import type { FormAction } from "@/shared/form-state";
import { AuthCard, linkTarget } from "./auth-card";
import { CodeForm } from "./code-form";
import { FormMessage } from "./form-message";
import { SubmitButton } from "./submit-button";
import { useCodeScreen } from "./use-code-screen";

type ResetCodeFormProps = {
  /** The address the code was asked for (remembered by this browser), or null: the form asks for it. */
  email: string | null;
  /** Where the Resend countdown starts (the server's own cooldown for the address). */
  cooldownSeconds: number;
  verifyAction: FormAction;
  resendAction: FormAction;
  changeEmailAction: () => Promise<void>;
};

/**
 * Forgot password, step 1 (spec 4.3): the emailed code, with the same behaviour as the sign-up
 * code screen. It never says whether the address has an account.
 */
export function ResetCodeForm({ email, cooldownSeconds, verifyAction, resendAction, changeEmailAction }: ResetCodeFormProps) {
  const screen = useCodeScreen(verifyAction, resendAction, cooldownSeconds);
  const { state, resendState } = screen;

  const resendMessage =
    resendState.status === "done" ? (
      <FormMessage tone="success" title="Check your email">
        If an account exists for that email, we sent a new code. It can take a minute to arrive.
      </FormMessage>
    ) : resendState.formError ? (
      <FormMessage tone="error" title={resendState.formError} />
    ) : null;

  return (
    <AuthCard
      title="Enter the code"
      description={
        email !== null ? (
          <>
            {AUTH_MESSAGES.resetCodeSent} Look for it at{" "}
            <span className="font-medium break-all text-foreground">{email}</span>. It expires in 10 minutes.
          </>
        ) : (
          <>Enter your email and the {CODE_LENGTH}-digit code we sent to it to reset your password.</>
        )
      }
      footer={
        <Link href="/login" className={linkTarget}>
          Back to log in
        </Link>
      }
    >
      <CodeForm
        email={email}
        next="/"
        action={screen.formAction}
        onSubmit={screen.submitOnce}
        formRef={screen.formRef}
        announcerRef={screen.announcerRef}
        pending={screen.pending}
        values={state.values}
        fieldErrors={screen.fieldErrors}
        formError={state.formError}
        onResend={screen.resend}
        resendPending={screen.resendPending}
        cooldownSeconds={screen.cooldown}
        cooldownKey={resendState}
        resendMessage={resendMessage}
        changeEmail={
          <form action={changeEmailAction}>
            <SubmitButton variant="outline" pendingLabel="Opening…">
              Change email
            </SubmitButton>
          </form>
        }
      />
    </AuthCard>
  );
}
