import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AuthCardSkeleton } from "@/client/components/auth/auth-card";
import { FormMessage } from "@/client/components/auth/form-message";
import { GoogleButton } from "@/client/components/auth/google-button";
import { GoogleConsent } from "@/client/components/auth/google-consent";
import { InAppBrowserNotice } from "@/client/components/auth/in-app-browser-notice";
import { LoginForm } from "@/client/components/auth/login-form";
import { getCurrentUser } from "@/server/auth/session";
import { AUTH_MESSAGES } from "@/shared/auth-messages";
import { logInAction, startGoogleAction } from "../actions";
import { inAppBrowser, nextFrom, param, withNext } from "../page-params";
import { sendNewCodeAction } from "../signup-actions";

export const metadata: Metadata = { title: "Log in | study-share" };

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <Suspense fallback={<AuthCardSkeleton />}>
      <Login searchParams={searchParams} />
    </Suspense>
  );
}

async function Login({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  const params = await searchParams;
  const next = nextFrom(params);
  const alternative = (await inAppBrowser()) ? (
    <InAppBrowserNotice />
  ) : (
    <div className="flex flex-col gap-3">
      <GoogleButton action={startGoogleAction} next={next} />
      <GoogleConsent />
      <p className="text-center text-sm text-muted-foreground">Signed up with Google? Use Continue with Google.</p>
    </div>
  );
  // Already signed in: go on (spec 6).
  if (await getCurrentUser()) redirect(next);

  const error = param(params, "error");
  // google_failed: Google signed the person in, but finishing the sign-in failed and they were
  // signed out (spec 5.3). oauth_failed: Google sent back no usable sign-in.
  const notice =
    error === "google_failed" ? (
      <FormMessage tone="error" title={AUTH_MESSAGES.googleFailed} />
    ) : error === "oauth_failed" ? (
      <FormMessage tone="error" title="Google sign-in did not finish">
        Please try again, or log in with your email.
      </FormMessage>
    ) : null;

  return (
    <LoginForm
      action={logInAction}
      resendAction={sendNewCodeAction}
      next={next}
      signupHref={withNext("/signup", next)}
      forgotHref="/forgot-password"
      alternative={alternative}
      notice={notice}
    />
  );
}
