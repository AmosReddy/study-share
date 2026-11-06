export type AuthUser = { id: string; email: string; displayName: string; termsVersion: string | null };

export type SignInResult = { ok: true } | { ok: false; reason: "invalid_credentials" | "email_not_confirmed" };

export class AuthProviderError extends Error {
  code: "rate_limited" | "weak_password" | "unavailable";

  constructor(code: AuthProviderError["code"], message?: string) {
    super(message ?? code);
    this.name = "AuthProviderError";
    this.code = code;
  }
}

/** Sign-in and account operations. `redirectTo` is always an absolute URL on the site. */
export interface AuthProvider {
  getUser(): Promise<AuthUser | null>;
  /** Neutral for an existing email: resolves the same way, so it does not reveal whether the address is registered. */
  signUpWithPassword(i: {
    email: string;
    password: string;
    displayName: string;
    termsVersion: string;
    redirectTo: string;
  }): Promise<void>;
  /** Neutral. */
  resendConfirmation(i: { email: string; redirectTo: string }): Promise<void>;
  signInWithPassword(i: { email: string; password: string }): Promise<SignInResult>;
  startGoogleSignIn(i: { redirectTo: string }): Promise<{ url: string }>;
  completeOAuth(code: string): Promise<boolean>;
  confirmEmailToken(i: { tokenHash: string; type: "email" | "recovery" }): Promise<boolean>;
  /** Neutral. */
  sendPasswordReset(i: { email: string; redirectTo: string }): Promise<void>;
  updatePassword(newPassword: string): Promise<void>;
  acceptTerms(i: { termsVersion: string }): Promise<void>;
  updateDisplayName(name: string): Promise<void>;
  signOut(): Promise<void>;
}
