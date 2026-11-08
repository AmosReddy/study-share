import { Suspense } from "react";
import { AccountMenu } from "@/client/components/auth/account-menu";
import { AppShell } from "@/client/components/app-shell/app-shell";
import { FormMessage } from "@/client/components/auth/form-message";
import { EmptyGroups } from "@/client/components/home/empty-groups";
import { Pitch } from "@/client/components/home/pitch";
import { Skeleton } from "@/client/components/ui/skeleton";
import { getCurrentUser, requireAcceptedTerms } from "@/server/auth/session";
import { AUTH_MESSAGES } from "@/shared/auth-messages";
import { logOutAction } from "./(auth)/actions";

export default function Home({ searchParams }: PageProps<"/">) {
  return (
    <Suspense fallback={<HomeSkeleton />}>
      <HomeContent searchParams={searchParams} />
    </Suspense>
  );
}

/**
 * Signed out: the pitch. Signed in: the app shell (after the terms, through /welcome if needed).
 * `?password=updated` is where a finished password reset lands (spec 4.3); it only shows the
 * message to a signed-in person and changes nothing.
 */
async function HomeContent({ searchParams }: Pick<PageProps<"/">, "searchParams">) {
  const passwordUpdated = (await searchParams).password === "updated";
  if (!(await getCurrentUser())) return <Pitch />;
  const user = await requireAcceptedTerms(passwordUpdated ? "/?password=updated" : "/");

  return (
    // Real groups arrive in the next step; until then the list is empty.
    <AppShell groups={[]} accountMenu={<AccountMenu name={user.displayName} email={user.email} logOutAction={logOutAction} />}>
      {passwordUpdated ? (
        <div className="mx-auto max-w-xl pt-4">
          <FormMessage tone="success" title={AUTH_MESSAGES.passwordUpdated} />
        </div>
      ) : null}
      <EmptyGroups />
    </AppShell>
  );
}

/** Shown while the page waits for the request (cookies). It is the same for signed-in and signed-out visitors. */
function HomeSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading" className="flex min-h-dvh flex-col gap-6 p-4">
      <noscript>
        <p className="rounded-lg border bg-muted p-3 text-sm">
          This page needs JavaScript. Please turn it on in your browser settings, then reload.
        </p>
      </noscript>
      <Skeleton className="h-11 w-full max-w-md" />
      <Skeleton className="h-9 w-3/4 max-w-md" />
      <Skeleton className="h-24 w-full max-w-md" />
    </div>
  );
}
