import { Suspense } from "react";
import { AccountMenu } from "@/client/components/auth/account-menu";
import { AppShell } from "@/client/components/app-shell/app-shell";
import { EmptyGroups } from "@/client/components/home/empty-groups";
import { Pitch } from "@/client/components/home/pitch";
import { Skeleton } from "@/client/components/ui/skeleton";
import { getCurrentUser, requireAcceptedTerms } from "@/server/auth/session";
import { logOutAction } from "./(auth)/actions";

export default function Home() {
  return (
    <Suspense fallback={<HomeSkeleton />}>
      <HomeContent />
    </Suspense>
  );
}

/** Signed out: the pitch. Signed in: the app shell (after the terms, through /welcome if needed). */
async function HomeContent() {
  if (!(await getCurrentUser())) return <Pitch />;
  const user = await requireAcceptedTerms("/");

  return (
    // Real groups arrive in the next step; until then the list is empty.
    <AppShell groups={[]} accountMenu={<AccountMenu name={user.displayName} email={user.email} logOutAction={logOutAction} />}>
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
