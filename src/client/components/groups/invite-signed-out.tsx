import Link from "next/link";
import type { ReactNode } from "react";
import { AuthCard, linkTarget } from "@/client/components/auth/auth-card";
import { FormMessage } from "@/client/components/auth/form-message";
import { GoogleButton } from "@/client/components/auth/google-button";
import { GoogleConsent } from "@/client/components/auth/google-consent";
import { InAppBrowserNotice } from "@/client/components/auth/in-app-browser-notice";
import { Button } from "@/client/components/ui/button";
import type { FormAction } from "@/shared/form-state";

type InviteSignedOutProps = {
  /** The group's name: the only thing a signed-out visitor learns about the group. */
  groupName: string;
  googleAction: FormAction;
  /** This invite page's own path, where every way in returns to. */
  next: string;
  signupHref: string;
  loginHref: string;
  /** Inside apps like Instagram Google refuses to sign in, so the notice replaces its button. */
  inAppBrowser: boolean;
};

/**
 * The invite page for someone who is not signed in (layout A): the group's name first, then the
 * two ways to make an account and the way to log in. Nothing to type here; the password, if
 * the group has one, is asked for once the person is signed in.
 */
export function InviteSignedOut({ groupName, googleAction, next, signupHref, loginHref, inAppBrowser }: InviteSignedOutProps) {
  return (
    <section className="w-full max-w-sm sm:rounded-xl sm:border sm:bg-card sm:p-8 sm:shadow-sm">
      <p className="text-muted-foreground">You&apos;re invited to join</p>
      <h1 className="mt-1 text-3xl leading-tight font-semibold [overflow-wrap:anywhere]">{groupName}</h1>
      <p className="mt-2 text-muted-foreground">on study-share. Make a free account to see its notes and papers.</p>

      <div className="mt-7 flex flex-col gap-3">
        {inAppBrowser ? (
          <InAppBrowserNotice />
        ) : (
          <>
            <GoogleButton action={googleAction} next={next} />
            <GoogleConsent />
          </>
        )}
        <Button asChild variant={inAppBrowser ? "default" : "outline"} className="h-11 w-full text-base">
          <Link href={signupHref}>Sign up with email</Link>
        </Button>
      </div>

      <p className="mt-8 border-t pt-6 text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href={loginHref} className={linkTarget}>
          Log in
        </Link>
      </p>
    </section>
  );
}

/** An invite that cannot be used, for a visitor signed in or not: the message and a way home. */
export function InviteProblem({ title, message, children }: { title: string; message: string; children?: ReactNode }) {
  return (
    <AuthCard
      title={title}
      footer={
        <Link href="/" className={linkTarget}>
          Go to the home page
        </Link>
      }
    >
      <FormMessage tone="error" title={message}>
        {children}
      </FormMessage>
    </AuthCard>
  );
}
