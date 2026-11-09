import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthCardSkeleton } from "@/client/components/auth/auth-card";
import { CreateGroupScreen } from "@/client/components/groups/create-group-form";
import { requireAcceptedTerms } from "@/server/auth/session";
import { SignedInFrame } from "../../_components/signed-in-frame";
import { createGroupAction } from "../actions";

export const metadata: Metadata = { title: "Create a group | study-share" };

export default function NewGroupPage() {
  return (
    <Suspense fallback={<div className="flex min-h-dvh justify-center px-4 pt-20"><AuthCardSkeleton fields={3} /></div>}>
      <NewGroup />
    </Suspense>
  );
}

/** Signed out goes to log in; signed in without the terms goes to /welcome; both come back here afterwards. */
async function NewGroup() {
  const user = await requireAcceptedTerms("/groups/new");

  return (
    <SignedInFrame user={user}>
      <div className="flex justify-center pt-2 lg:pt-10">
        <CreateGroupScreen action={createGroupAction} />
      </div>
    </SignedInFrame>
  );
}
