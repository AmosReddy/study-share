/**
 * What a form's server action returns to the screen. `values` echoes what was typed
 * (never passwords) so the fields keep it after an error, also without JavaScript.
 */
export type FormState = {
  status: "idle" | "error" | "done";
  fieldErrors?: Record<string, string>;
  formError?: string;
  /** Log-in only: the address is registered but not confirmed yet. */
  needsConfirmation?: boolean;
  values?: Record<string, string>;
  /** A same-site address the browser must load as a full page (see startGoogleAction). */
  navigateTo?: string;
};

export type FormAction = (state: FormState, formData: FormData) => Promise<FormState>;

export const IDLE: FormState = { status: "idle" };
