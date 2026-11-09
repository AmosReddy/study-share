import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthCardSkeleton } from "@/client/components/auth/auth-card";
import { ResetCodeForm } from "@/client/components/auth/reset-code-form";
import { readResetScreenState } from "@/server/auth/reset-cookies";
import { changeResetEmailAction, resendResetCodeAction, verifyResetCodeAction } from "../reset-actions";

export const metadata: Metadata = { title: "Enter the code | study-share" };

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<AuthCardSkeleton fields={1} />}>
      <ResetCode />
    </Suspense>
  );
}

/*
  Forgot password, step 1 (spec 4.3). The address the code was asked for is remembered by a
  short-lived cookie, so a reload resumes here; without it (cookies off, another device) the
  screen asks for the address too. The next step is /reset-password/new.
*/
async function ResetCode() {
  const screen = await readResetScreenState();
  return (
    <ResetCodeForm
      email={screen.email}
      cooldownSeconds={screen.cooldownSeconds}
      verifyAction={verifyResetCodeAction}
      resendAction={resendResetCodeAction}
      changeEmailAction={changeResetEmailAction}
    />
  );
}
