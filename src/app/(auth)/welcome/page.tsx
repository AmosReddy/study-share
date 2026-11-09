import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AuthCardSkeleton } from "@/client/components/auth/auth-card";
import { WelcomeForm } from "@/client/components/auth/welcome-form";
import { authRedirectTarget, getCurrentUser } from "@/server/auth/session";
import { TERMS_VERSION } from "@/shared/legal";
import { acceptTermsAction } from "../actions";
import { nextFrom, withNext } from "../page-params";

export const metadata: Metadata = { title: "One last step | study-share" };

export default function WelcomePage({ searchParams }: PageProps<"/welcome">) {
  return (
    <Suspense fallback={<AuthCardSkeleton fields={1} />}>
      <Welcome searchParams={searchParams} />
    </Suspense>
  );
}

/*
  Never call requireUser or requireAcceptedTerms here: they would send the person
  back to this page. The checks are done by hand instead.
*/
async function Welcome({ searchParams }: Pick<PageProps<"/welcome">, "searchParams">) {
  const requested = nextFrom(await searchParams);
  // Returning to /welcome itself after accepting would loop.
  const next = requested.startsWith("/welcome") ? "/" : requested;
  const user = await getCurrentUser();

  if (!user) redirect(authRedirectTarget(null, withNext("/welcome", next)) ?? "/login");
  if (user.termsVersion === TERMS_VERSION) redirect(next);

  return <WelcomeForm action={acceptTermsAction} next={next} termsVersion={TERMS_VERSION} name={user.displayName} />;
}
