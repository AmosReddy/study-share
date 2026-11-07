export type AuthUser = { id: string; email: string; displayName: string; termsVersion: string | null };

export type SignInResult = { ok: true } | { ok: false; reason: "invalid_credentials" | "email_not_confirmed" };

/** Which emailed code: the one that confirms a sign-up, or the one for a forgotten password. */
export type CodeKind = "signup" | "recovery";

/**
 * The result of checking an emailed code. On success a session now exists for `userId`.
 * There is one failure reason on purpose: the provider answers a wrong, used, superseded and
 * expired code identically (checked live, Task 1), so nothing finer can be told honestly.
 */
export type VerifyCodeResult = { ok: true; userId: string } | { ok: false; reason: "invalid_or_expired" };

export class AuthProviderError extends Error {
  code: "rate_limited" | "weak_password" | "unavailable";

  constructor(code: AuthProviderError["code"], message?: string) {
    super(message ?? code);
    this.name = "AuthProviderError";
    this.code = code;
  }
}

/**
 * Sign-in and account operations. `redirectTo` is always an absolute URL on the site.
 *
 * Errors are AuthProviderError with a fixed message: never vendor text, codes, passwords or
 * addresses.
 */
export interface AuthProvider {
  getUser(): Promise<AuthUser | null>;
  /**
   * Creates a pending (unconfirmed) account and emails it a sign-up code. Behaves like the
   * provider does (checked live): a repeat sign-up of an UNCONFIRMED address returns the same
   * user id, emails a new code (the old one stops working) and keeps the FIRST password; a
   * sign-up of a confirmed address sends nothing and returns a stand-in id. So the returned id
   * is not proof of anything: ask the AccountDirectory for the address's state. It may be ""
   * when the provider gave no id at all.
   *
   * Email interval (checked live, probe n): the provider allows one sign-up/resend email per
   * address per about 60 s; a repeat sign-up 3 s after the first throws
   * AuthProviderError("rate_limited") instead of emailing a new code. Callers must handle
   * rate_limited, and the sign-up use-case's own one-email-a-minute cooldown must decide first,
   * so the provider's 429 (which only a pending address gets) is never what the person sees.
   *
   * `redirectTo` is deprecated (the link flow, removed in Task 5): when it is given, the
   * confirmation email is the old link email instead of a code.
   */
  signUpWithPassword(i: {
    email: string;
    password: string;
    displayName: string;
    termsVersion: string;
    /** @deprecated Link flow only. Task 5 removes it. */
    redirectTo?: string;
  }): Promise<{ userId: string }>;
  /**
   * Emails a new sign-up code to a pending account; the earlier code stops working. Neutral for
   * confirmed and unknown addresses. Shares the sign-up email interval: a second resend within
   * about 60 s (observed: 3 s) throws rate_limited (probe n).
   */
  resendSignUpCode(i: { email: string }): Promise<void>;
  /**
   * Emails a recovery code. Neutral: resolves the same way for an unknown address. A second
   * request for one address within about 60 s (observed: 3 s) throws rate_limited (probe n).
   */
  sendPasswordResetCode(i: { email: string }): Promise<void>;
  /** Checks an emailed code; a correct sign-up code also confirms the address. Signs in on success. */
  verifyCode(i: { email: string; code: string; kind: CodeKind }): Promise<VerifyCodeResult>;
  signInWithPassword(i: { email: string; password: string }): Promise<SignInResult>;
  /** The Google sign-in URL. It always asks Google for the account chooser (prompt=select_account). */
  startGoogleSignIn(i: { redirectTo: string }): Promise<{ url: string }>;
  completeOAuth(code: string): Promise<boolean>;
  /**
   * Sets the signed-in user's password. Observed (probes l, l2, m):
   * - it works only from a CODE session (verifyCode, or the deprecated link); from a password
   *   sign-in session the provider refuses (current_password_required), which is thrown as
   *   AuthProviderError("unavailable"), and nothing changes;
   * - on success this session stays, every OTHER session of the user ends at once (access
   *   token and refresh) even without `signOutOthers`, and outstanding codes stop working.
   * `signOutOthers` also asks for the sign-out explicitly, so the promise does not depend on
   * that provider behaviour.
   */
  updatePassword(newPassword: string, opts?: { signOutOthers?: boolean }): Promise<void>;
  /**
   * Replaces the user's password with a random one nobody knows (server-side, admin power). The
   * value is never returned, logged or kept, so a stranger's password never survives.
   *
   * Observed (probes k, m): it ends EVERY session of the user at once, INCLUDING the caller's
   * (a session verifyCode just made is gone: getUser is null, updatePassword fails), and
   * outstanding codes stop working. So "verify a code, scramble, then updatePassword in the
   * same session" cannot work; after a scramble the person needs a new code to get a session.
   */
  scramblePassword(userId: string): Promise<void>;
  /**
   * Opens a fresh session for the account with this address in THIS browser, without sending
   * an email (server side: the provider's admin power makes a one-time recovery code and
   * redeems it at once). It is a recovery session, so updatePassword works from it. Returns the
   * user's id. The code or token is never returned or logged.
   *
   * DANGER: it signs anyone in as that account. Call it ONLY on the server, right after the
   * same request proved ownership of the account by a code (verifyCode) or a Google sign-in,
   * typically just after scramblePassword ended every session (ruling P9: verify, scramble,
   * open a session, then the person creates a password). It must never be reachable from a
   * request that has not just proved ownership. An unknown address throws unavailable.
   *
   * Observed (probes p, q): it works after a scramble, for accounts with and without a
   * password; the provider records it as a recovery request (recovery_sent_at is set), which
   * may start the recovery email interval for that address (not probed).
   */
  openSessionWithoutEmail(i: { email: string }): Promise<{ userId: string }>;
  acceptTerms(i: { termsVersion: string }): Promise<void>;
  updateDisplayName(name: string): Promise<void>;
  signOut(): Promise<void>;

  /** @deprecated Link flow. Task 5 removes it; use resendSignUpCode. Neutral. */
  resendConfirmation(i: { email: string; redirectTo: string }): Promise<void>;
  /** @deprecated Link flow. Task 5 removes it; use verifyCode. */
  confirmEmailToken(i: { tokenHash: string; type: "email" | "recovery" }): Promise<boolean>;
  /** @deprecated Link flow. Task 5 removes it; use sendPasswordResetCode. Neutral. */
  sendPasswordReset(i: { email: string; redirectTo: string }): Promise<void>;
}
