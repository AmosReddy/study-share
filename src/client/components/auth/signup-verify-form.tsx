"use client";

import Link from "next/link";
import { CODE_LENGTH } from "@/shared/auth-schemas";
import type { FormAction } from "@/shared/form-state";
import { AuthCard, linkTarget } from "./auth-card";
import { CodeForm } from "./code-form";
import { FormMessage } from "./form-message";
import { SubmitButton } from "./submit-button";
import { useCodeScreen } from "./use-code-screen";

type SignupVerifyFormProps = {
  /** The address from the pending sign-up cookie, or null (another device or a cleared browser). */
  email: string | null;
  /** Without a cookie: the address to pre-fill (from the log-in page), or "". */
  prefillEmail: string;
  next: string;
  /** Where the Resend countdown starts (the server's own cooldown for the address). */
  cooldownSeconds: number;
  loginHref: string;
  verifyAction: FormAction;
  resendAction: FormAction;
  changeEmailAction: (form: FormData) => Promise<void>;
};

/** The sign-up code screen (spec 4.1 step 3). */
export function SignupVerifyForm({
  email,
  prefillEmail,
  next,
  cooldownSeconds,
  loginHref,
  verifyAction,
  resendAction,
  changeEmailAction,
}: SignupVerifyFormProps) {
  const screen = useCodeScreen(verifyAction, resendAction, cooldownSeconds);
  const { state, resendState } = screen;

  const resendMessage =
    resendState.status === "done" ? (
      <FormMessage tone="success" title="Check your email">
        If this address is waiting to be confirmed, we&apos;ve sent a new code. It can take a minute to arrive.
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
            We sent a {CODE_LENGTH}-digit code to <span className="font-medium break-all text-foreground">{email}</span>.
            It expires in 10 minutes.
          </>
        ) : (
          <>Enter the email you signed up with and the {CODE_LENGTH}-digit code we sent to it.</>
        )
      }
      footer={
        <>
          Already have an account?{" "}
          <Link href={loginHref} className={linkTarget}>
            Log in
          </Link>
        </>
      }
    >
      <CodeForm
        email={email}
        defaultEmail={prefillEmail}
        next={next}
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
            <input type="hidden" name="next" value={next} />
            <SubmitButton variant="outline" pendingLabel="Opening…">
              Change email
            </SubmitButton>
          </form>
        }
      />
    </AuthCard>
  );
}
