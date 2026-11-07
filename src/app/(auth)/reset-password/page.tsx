import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthCardSkeleton } from "@/client/components/auth/auth-card";
import { ResetLinkExpired, ResetPasswordForm } from "@/client/components/auth/reset-password-form";
import { getCurrentUser } from "@/server/auth/session";
import { resetPasswordAction } from "../actions";

export const metadata: Metadata = { title: "Choose a new password | study-share" };

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<AuthCardSkeleton />}>
      <ResetPassword />
    </Suspense>
  );
}

/** The reset link signs the person in; without that session there is nothing to reset. */
async function ResetPassword() {
  const user = await getCurrentUser();
  return user ? <ResetPasswordForm action={resetPasswordAction} /> : <ResetLinkExpired />;
}
