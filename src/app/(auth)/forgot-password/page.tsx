import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/client/components/auth/forgot-password-form";
import { forgotPasswordAction } from "../actions";

export const metadata: Metadata = { title: "Reset your password | study-share" };

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm action={forgotPasswordAction} />;
}
