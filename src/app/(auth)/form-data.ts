import type { ActionResult } from "@/server/use-case-kit";
import type { FormState } from "@/shared/form-state";

/** Helpers shared by the server actions. */

/** A text field from the form, or "". */
export function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/** A failed use-case result as screen state, echoing `values` (never passwords). */
export function failed(result: Extract<ActionResult<unknown>, { ok: false }>, values: Record<string, string>): FormState {
  return {
    status: "error",
    fieldErrors: result.fieldErrors,
    formError: result.formError,
    values,
    ...(result.retryAfterSeconds ? { retryAfterSeconds: result.retryAfterSeconds } : {}),
  };
}
