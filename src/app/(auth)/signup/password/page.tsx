import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AuthCardSkeleton } from "@/client/components/auth/auth-card";
import { SetPasswordForm } from "@/client/components/auth/set-password-form";
import { getCurrentUser } from "@/server/auth/session";
import { nextFrom } from "../../page-params";
import { setPasswordAction } from "../../signup-actions";

export const metadata: Metadata = { title: "Create your password | study-share" };

export default function CreatePasswordPage({ searchParams }: PageProps<"/signup/password">) {
  return (
    <Suspense fallback={<AuthCardSkeleton fields={2} />}>
      <CreatePassword searchParams={searchParams} />
    </Suspense>
  );
}

/*
  Spec 5.1: a code confirmed an account this browser did not create (or there was no cookie),
  so its password was replaced with a random one and this browser got a fresh session. The
  person chooses a password here; if they leave, the password stays random (Forgot password
  recovers the account).
*/
async function CreatePassword({ searchParams }: Pick<PageProps<"/signup/password">, "searchParams">) {
  const next = nextFrom(await searchParams);
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <SetPasswordForm
      action={setPasswordAction}
      next={next}
      title="Create your password"
      description="Your email is confirmed. Choose a password to finish signing up."
      accountEmail={user.email}
      recovery={{ href: "/forgot-password", label: "Forgot your password?" }}
    />
  );
}
