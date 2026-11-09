/** What the server knows about one email address, from the accounts store. */
export type EmailAccountState =
  | { kind: "none" }
  /** An email sign-up whose address has not been confirmed, with no non-email identity. */
  | { kind: "pending"; userId: string }
  /**
   * An account that counts as real. Normally the address is confirmed, but an account with any
   * non-email identity (such as Google) is reported as confirmed even if its confirmation time
   * is still empty, so it is never mistaken for a pending sign-up and removed.
   *
   * `hasPassword` only means "an encrypted password is stored". It cannot tell a password the
   * person chose from one nobody knows: accounts created through the admin API always have one
   * (observed), and the app's own steps that set a random password (a Google repair, or a code
   * confirmed from another device) leave one too. So `hasPassword: false` is trustworthy only for
   * a never-touched Google account; a repaired or scrambled one reads as "has a password". Do not
   * decide "Google-only" from `hasPassword` alone: the worst outcome is the wrong wording of a
   * message for those users.
   */
  | { kind: "confirmed"; userId: string; providers: ("email" | "google")[]; hasPassword: boolean };

/**
 * Reads who has an account and removes unconfirmed sign-ups, which the auth provider's own
 * API cannot do (no lookup by email, no conditional delete).
 */
export interface AccountDirectory {
  /** Case-insensitive; surrounding spaces are ignored. */
  describeEmail(email: string): Promise<EmailAccountState>;
  /**
   * Deletes any unconfirmed account for this address (it works by address, not by user). The
   * delete is one conditional statement: the address must still be unconfirmed and the account
   * must have no non-email identity, so an account confirmed a moment ago, or one with a Google
   * identity, is never removed. Returns whether a row was deleted (of two simultaneous calls,
   * only one is told true).
   */
  removePendingSignup(email: string): Promise<boolean>;
  /**
   * Read only: whether the user has what repairAfterGoogle would remove, i.e. an unverified email
   * identity AND a Google identity (the same condition, nothing deleted). The Google repair checks
   * this first and removes the identity LAST, so a repair that fails half-way is found again at
   * the next Google sign-in.
   */
  hasPendingEmailIdentity(userId: string): Promise<boolean>;
  /**
   * Call ONLY right after a Google sign-in for that user. Removes the user's unverified email
   * identity (a stranger's earlier password sign-up) and reports whether there was one. It does
   * nothing for a user without a Google identity, and never touches a verified email identity or
   * a Google identity. "Unverified" is an email_verified of false or missing, which a confirmed
   * password user's identity can also have (admin-created users, or old identities), so calling
   * this for anyone but a user who just signed in with Google is a misuse.
   */
  repairAfterGoogle(userId: string): Promise<{ hadPendingEmailSignup: boolean }>;
}
