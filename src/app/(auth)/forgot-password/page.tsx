import type { Metadata } from "next";
import { Suspense } from "react";
import { ForgotPasswordForm } from "@/client/components/auth/forgot-password-form";
import { FormMessage } from "@/client/components/auth/form-message";
import { forgotPasswordAction } from "../actions";
import { param } from "../page-params";

export const metadata: Metadata = { title: "Reset your password | study-share" };

export default function ForgotPasswordPage({ searchParams }: PageProps<"/forgot-password">) {
  // Only the notice reads the address, so the form itself stays in the static page and works without JavaScript.
  return (
    <ForgotPasswordForm
      action={forgotPasswordAction}
      notice={
        <Suspense fallback={null}>
          <ExpiredLinkNotice searchParams={searchParams} />
        </Suspense>
      }
    />
  );
}

async function ExpiredLinkNotice({ searchParams }: Pick<PageProps<"/forgot-password">, "searchParams">) {
  if (param(await searchParams, "error") !== "link_expired") return null;
  return (
    <FormMessage tone="error" title="This reset link has expired or was already used.">
      Enter your email and we will send a new one.
    </FormMessage>
  );
}
