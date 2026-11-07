/** What the server knows about one email address, from the accounts store. */
export type EmailAccountState =
  | { kind: "none" }
  /** A sign-up whose address has not been confirmed yet. */
  | { kind: "pending"; userId: string }
  | { kind: "confirmed"; userId: string; providers: ("email" | "google")[]; hasPassword: boolean };

/**
 * Reads who has an account and removes unconfirmed sign-ups, which the auth provider's own
 * API cannot do (no lookup by email, no conditional delete).
 */
export interface AccountDirectory {
  /** Case-insensitive; surrounding spaces are ignored. */
  describeEmail(email: string): Promise<EmailAccountState>;
  /**
   * Deletes the unconfirmed account for this address. The delete is conditional on the address
   * still being unconfirmed, so an account confirmed a moment ago is never removed. Returns
   * whether a row was deleted (of two simultaneous calls, only one is told true).
   */
  removePendingSignup(email: string): Promise<boolean>;
  /**
   * After a Google sign-in: removes this user's unverified email identity (a stranger's earlier
   * password sign-up) and reports whether there was one. Never touches a verified email
   * identity or a Google identity.
   */
  repairAfterGoogle(userId: string): Promise<{ hadPendingEmailSignup: boolean }>;
}
