import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthCardSkeleton } from "@/client/components/auth/auth-card";
import { FormMessage } from "@/client/components/auth/form-message";
import { GoogleButton } from "@/client/components/auth/google-button";
import { InAppBrowserNotice } from "@/client/components/auth/in-app-browser-notice";
import { LoginForm } from "@/client/components/auth/login-form";
import { ResendForm } from "@/client/components/auth/resend-form";
import { logInAction, resendConfirmationAction, startGoogleAction } from "../actions";
import { inAppBrowser, nextFrom, param, withNext } from "../page-params";

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
  const error = param(params, "error");
  const alternative = (await inAppBrowser()) ? (
    <InAppBrowserNotice />
  ) : (
    <GoogleButton action={startGoogleAction} next={next} />
  );

  let notice = null;
  if (error === "link_expired") {
    notice = (
      <div className="flex flex-col gap-4">
        <FormMessage tone="error" title="This link has expired or was already used">
          Email links work once and only for a while. If you have confirmed already, just log in. Otherwise enter your
          email and we&apos;ll send a new confirmation link.
        </FormMessage>
        <ResendForm action={resendConfirmationAction} next={next} buttonLabel="Send a new link" />
      </div>
    );
  } else if (error === "oauth_failed") {
    notice = (
      <FormMessage tone="error" title="Google sign-in did not finish">
        Please try again, or log in with your email.
      </FormMessage>
    );
  }

  return (
    <LoginForm
      action={logInAction}
      resendAction={resendConfirmationAction}
      next={next}
      signupHref={withNext("/signup", next)}
      forgotHref="/forgot-password"
      alternative={alternative}
      notice={notice}
    />
  );
}
