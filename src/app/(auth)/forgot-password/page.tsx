import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/client/components/auth/forgot-password-form";
import { forgotPasswordAction } from "../actions";

export const metadata: Metadata = { title: "Reset your password | study-share" };

/** Task 6 rebuilds this screen for the emailed recovery code. */
export default function ForgotPasswordPage() {
  return <ForgotPasswordForm action={forgotPasswordAction} />;
}
