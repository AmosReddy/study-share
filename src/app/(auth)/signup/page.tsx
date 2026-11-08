import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AuthCardSkeleton } from "@/client/components/auth/auth-card";
import { GoogleButton } from "@/client/components/auth/google-button";
import { InAppBrowserNotice } from "@/client/components/auth/in-app-browser-notice";
import { SignupForm } from "@/client/components/auth/signup-form";
import { getCurrentUser } from "@/server/auth/session";
import { startGoogleAction } from "../actions";
import { inAppBrowser, nextFrom, withNext } from "../page-params";
import { signUpAction } from "../signup-actions";

export const metadata: Metadata = { title: "Create your account | study-share" };

export default function SignupPage({ searchParams }: PageProps<"/signup">) {
  return (
    <Suspense fallback={<AuthCardSkeleton fields={3} />}>
      <Signup searchParams={searchParams} />
    </Suspense>
  );
}

async function Signup({ searchParams }: Pick<PageProps<"/signup">, "searchParams">) {
  const next = nextFrom(await searchParams);
  const alternative = (await inAppBrowser()) ? (
    <InAppBrowserNotice />
  ) : (
    <GoogleButton action={startGoogleAction} next={next} />
  );
  // Already signed in: there is nothing to sign up for (spec 6).
  if (await getCurrentUser()) redirect(next);

  return (
    <SignupForm
      action={signUpAction}
      next={next}
      loginHref={withNext("/login", next)}
      forgotHref="/forgot-password"
      alternative={alternative}
    />
  );
}
