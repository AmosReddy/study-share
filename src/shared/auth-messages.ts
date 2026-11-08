import { CODE_LENGTH } from "./auth-schemas";

/**
 * Every sentence the sign-in use-cases show, in one place so the owner can change the wording.
 * Some are fixed by the registration spec (2026-11-07) word for word; their tests pin them.
 * None of them names an address, a code or anything from the auth provider.
 */
export const AUTH_MESSAGES = {
  tooMany: "Too many attempts. Please try again later.",
  justSent: "We just sent you an email. Please wait a minute before trying again.",
  couldNotSend: "We couldn't send the email right now. Please try again in a few minutes.",
  generic: "Something went wrong. Please try again.",
  badLogin: "That email and password do not match.",
  badForm: "Check the form and try again.",
  logOutFailed: "We could not log you out. Please try again.",
  weakPassword: "Choose a stronger password with at least 8 characters.",
  passwordsDiffer: "The two passwords do not match.",
  termsChanged: "The terms have changed since you opened this page. Please reload and review them.",

  /** Spec 3 and 4.1: sign-up says clearly that an address is taken (the owner's choice). */
  emailTaken: "This email already has an account. Log in or reset your password.",
  /** Spec 3: an address that exists only as a Google account. */
  googleOnly: "This email is registered with Google. Continue with Google, or reset your password to add one.",

  /** A code that is not CODE_LENGTH digits (after dropping spaces and dashes). Never sent to the provider. */
  codeFormat: `Enter the ${CODE_LENGTH}-digit code from the email.`,
  /** Spec 6: wrong, used, superseded and expired codes are indistinguishable at the provider. */
  codeInvalid: "That code is wrong or has expired. Request a new one.",
  /** Our own wrong-code limit (5 per 15 minutes per address). */
  tooManyCodes: "Too many wrong codes. Try again in 15 minutes.",
  /** The provider is down while checking a code: not the person's fault, so not "retype it". */
  codeCheckUnavailable: "We couldn't check the code right now. Please try again in a few minutes.",
  /** Spec 5.1: the code confirmed the address but no session could be opened after the scramble. */
  confirmedSetPassword: "Your email is confirmed. Set a password with Forgot password to log in.",
  /** Spec 5.3: anything failed after Google issued a session; the person is signed out. */
  googleFailed: "Something went wrong signing you in with Google. Please try again.",
  /** Setting a password needs the session a code just opened, and there is none. */
  sessionEnded: "Your session has ended. Request a new code to continue.",
  /** The password changed but the explicit sign-out of other devices failed (spec 5.4). */
  otherDevicesMaybeSignedIn:
    "Your password was changed, but we could not confirm that your other devices were signed out. They may stay signed in for up to an hour.",

  /** Spec 3 and 4.3: Forgot password's one reply, the same for every address. */
  resetCodeSent: "If an account exists for that email, we sent a code.",
  /** Spec 4.3: shown on the home page after a password reset. */
  passwordUpdated: "Password updated",
  /** Spec 3: shown under both buttons on /signup and /login; pressing Google records the acceptance. */
  googleConsent: "By continuing you confirm you are 18 or older and accept the Terms and Privacy Notice",
} as const;
