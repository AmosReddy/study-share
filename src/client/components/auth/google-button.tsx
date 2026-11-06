"use client";

import { useActionState, useEffect } from "react";
import { IDLE, type FormAction } from "@/shared/form-state";
import { FormMessage } from "./form-message";
import { SubmitButton } from "./submit-button";

/** "Continue with Google". A real form, so it also works without JavaScript. */
export function GoogleButton({ action, next }: { action: FormAction; next: string }) {
  const [state, formAction] = useActionState(action, IDLE);

  useEffect(() => {
    if (state.navigateTo) window.location.assign(state.navigateTo);
  }, [state]);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="next" value={next} />
      <SubmitButton variant="outline" pendingLabel="Opening Google…">
        <GoogleMark />
        Continue with Google
      </SubmitButton>
      {state.formError ? <FormMessage tone="error" title={state.formError} /> : null}
    </form>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.47a5.53 5.53 0 0 1-2.4 3.63v3h3.88c2.27-2.09 3.57-5.17 3.57-8.82Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.07 7.95-2.91l-3.88-3c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.95H1.27v3.1A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.29A7.2 7.2 0 0 1 4.9 12c0-.8.14-1.57.37-2.29v-3.1H1.27A12 12 0 0 0 0 12c0 1.94.46 3.77 1.27 5.39l4-3.1Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.27 6.61l4 3.1C6.22 6.86 8.87 4.75 12 4.75Z"
      />
    </svg>
  );
}
