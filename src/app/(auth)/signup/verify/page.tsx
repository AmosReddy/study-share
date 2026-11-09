import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AuthCardSkeleton } from "@/client/components/auth/auth-card";
import { SignupVerifyForm } from "@/client/components/auth/signup-verify-form";
import { getCurrentUser } from "@/server/auth/session";
import { readCodeScreenState } from "@/server/auth/signup-cookies";
import { nextFrom, withNext } from "../../page-params";
import { changeEmailAction, resendCodeAction, verifyCodeAction } from "../../signup-actions";

export const metadata: Metadata = { title: "Enter the code | study-share" };

export default function SignupVerifyPage({ searchParams }: PageProps<"/signup/verify">) {
  return (
    <Suspense fallback={<AuthCardSkeleton fields={1} />}>
      <SignupVerify searchParams={searchParams} />
    </Suspense>
  );
}

/*
  The code screen. The signed pending sign-up cookie (only sent to /signup pages) names the
  address, so a reload or a reopened tab resumes here; without it the screen asks for the
  address too (another device, a cleared browser, cookies off).
*/
async function SignupVerify({ searchParams }: Pick<PageProps<"/signup/verify">, "searchParams">) {
  const next = nextFrom(await searchParams);
  const screen = await readCodeScreenState();
  // Already signed in (for example the code was accepted in another tab): go on (spec 6).
  if (await getCurrentUser()) redirect(next);

  return (
    <SignupVerifyForm
      email={screen.email}
      prefillEmail={screen.prefillEmail}
      next={next}
      cooldownSeconds={screen.cooldownSeconds}
      loginHref={withNext("/login", next)}
      verifyAction={verifyCodeAction}
      resendAction={resendCodeAction}
      changeEmailAction={changeEmailAction}
    />
  );
}
