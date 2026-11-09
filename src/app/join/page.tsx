import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthCard, AuthCardSkeleton } from "@/client/components/auth/auth-card";
import { FindGroupForm } from "@/client/components/groups/join-form";
import { requireAcceptedTerms } from "@/server/auth/session";
import { SignedInFrame } from "../_components/signed-in-frame";
import { findGroupByCodeAction } from "../groups/actions";

export const metadata: Metadata = { title: "Join a group | study-share" };

export default function JoinPage() {
  return (
    <Suspense fallback={<div className="flex min-h-dvh justify-center px-4 pt-20"><AuthCardSkeleton fields={1} /></div>}>
      <Join />
    </Suspense>
  );
}

/**
 * Join by code. Signed out goes to log in; signed in without the terms goes to /welcome; both
 * come back here. A found code goes on to its invite page, which does the joining.
 */
async function Join() {
  const user = await requireAcceptedTerms("/join");

  return (
    <SignedInFrame user={user}>
      <div className="flex justify-center pt-2 lg:pt-10">
        <AuthCard title="Join a group" description="Type the group code you were sent.">
          <FindGroupForm action={findGroupByCodeAction} />
        </AuthCard>
      </div>
    </SignedInFrame>
  );
}
