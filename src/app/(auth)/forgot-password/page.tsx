import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/client/components/auth/forgot-password-form";
import { forgotPasswordAction } from "../reset-actions";

export const metadata: Metadata = { title: "Reset your password | study-share" };

/** Forgot password (spec 4.3): the address; the code and the new password follow on /reset-password. */
export default function ForgotPasswordPage() {
  return <ForgotPasswordForm action={forgotPasswordAction} />;
}
