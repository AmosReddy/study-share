import { AUTH_MESSAGES } from "@/shared/auth-messages";
import type { FormAction } from "@/shared/form-state";

/** Next's redirect() and notFound() work by throwing errors whose digest starts with NEXT_. */
function isNextControlFlow(error: unknown): boolean {
  const digest = typeof error === "object" && error !== null ? (error as { digest?: unknown }).digest : undefined;
  return typeof digest === "string" && digest.startsWith("NEXT_");
}

/**
 * Wraps a server action so a request that fails (the network dropped, the server was unreachable)
 * shows the form's own error and leaves the form usable, instead of the blank error page. What was
 * typed is kept. The error's text is never shown. Redirects and not-found are not failures and are
 * thrown on to Next.
 */
export function guardAction(action: FormAction): FormAction {
  return async (previous, form) => {
    try {
      return await action(previous, form);
    } catch (error) {
      if (isNextControlFlow(error)) throw error;
      return { status: "error", formError: AUTH_MESSAGES.actionFailed, values: previous.values };
    }
  };
}
