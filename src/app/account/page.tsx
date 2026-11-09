import type { Metadata } from "next";
import { Suspense } from "react";
import { AccountForm } from "@/client/components/auth/account-form";
import { AuthCardSkeleton } from "@/client/components/auth/auth-card";
import { requireAcceptedTerms } from "@/server/auth/session";
import { logOutAction, updateProfileAction } from "../(auth)/actions";
import { SignedInFrame } from "../_components/signed-in-frame";

export const metadata: Metadata = { title: "Account | study-share" };

export default function AccountPage() {
  return (
    <Suspense fallback={<div className="flex min-h-dvh justify-center px-4 pt-20"><AuthCardSkeleton fields={1} /></div>}>
      <Account />
    </Suspense>
  );
}

/** Signed out goes to log in; signed in without the terms goes to /welcome; both come back here afterwards. */
async function Account() {
  const user = await requireAcceptedTerms("/account");

  return (
    <SignedInFrame user={user}>
      <div className="flex justify-center pt-2 lg:pt-10">
        <AccountForm action={updateProfileAction} logOutAction={logOutAction} name={user.displayName} email={user.email} />
      </div>
    </SignedInFrame>
  );
}
