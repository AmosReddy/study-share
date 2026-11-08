import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AuthCardSkeleton } from "@/client/components/auth/auth-card";
import { SetPasswordForm } from "@/client/components/auth/set-password-form";
import { getCurrentUser } from "@/server/auth/session";
import { resetPasswordAction } from "../../reset-actions";

export const metadata: Metadata = { title: "Create a new password | study-share" };

export default function NewPasswordPage() {
  return (
    <Suspense fallback={<AuthCardSkeleton fields={2} />}>
      <NewPassword />
    </Suspense>
  );
}

/*
  Forgot password, step 2 (spec 4.3): the code signed the person in; they choose a new password
  here. Saving it signs out every other device and lands on home with "Password updated".
  Without a session there is nothing to change: back to the code step.
*/
async function NewPassword() {
  const user = await getCurrentUser();
  if (!user) redirect("/reset-password");

  return (
    <SetPasswordForm
      action={resetPasswordAction}
      next="/"
      title="Create a new password"
      description="Use at least 8 characters. Your other devices will be signed out."
      accountEmail={user.email}
      recovery={{ href: "/forgot-password", label: "Get a new code" }}
    />
  );
}
