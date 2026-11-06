import { createServerClient } from "@supabase/ssr";
import { isAuthError, isAuthRetryableFetchError, isAuthWeakPasswordError, type SupabaseClient } from "@supabase/supabase-js";
import { AuthProviderError, type AuthProvider, type AuthUser } from "../ports/auth-provider";

/*
  Supabase Auth behind our AuthProvider port. Create one provider per request:
  the server client keeps the session in the request's cookies, and Supabase
  only hands out the no-cache headers on the first cookie write of a client.

  Supabase's own error messages are never passed on or logged, because a
  message could echo what was sent. Our errors carry only a fixed message.
*/

export type CookieJar = {
  getAll(): { name: string; value: string }[];
  setAll(items: { name: string; value: string; options?: object }[]): void;
};

/** The part of the Supabase client this adapter uses. Tests pass a stand-in. */
export type SupabaseAuthClient = Pick<SupabaseClient, "auth">;

export function createSupabaseAuthProvider(
  deps: { url: string; anonKey: string; cookies: CookieJar },
  client?: SupabaseAuthClient,
): AuthProvider {
  const { auth } =
    client ??
    createServerClient(deps.url, deps.anonKey, {
      cookies: {
        getAll: () => deps.cookies.getAll(),
        setAll: (items) => deps.cookies.setAll(items),
      },
    });

  /** Runs one Supabase call. A thrown error (rather than a returned one) is a network failure. */
  async function call<T extends { error: unknown }>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch {
      throw new AuthProviderError("unavailable", "The sign-in service could not be reached.");
    }
  }

  async function updateMetadata(data: Record<string, string>) {
    const { error } = await call(() => auth.updateUser({ data }));
    if (error) throw toProviderError(error);
    // getUser reads the signed token, which still holds the old metadata until it is reissued.
    const refreshed = await call(() => auth.refreshSession());
    if (refreshed.error) throw toProviderError(refreshed.error);
  }

  return {
    async getUser() {
      const { data, error } = await call(() => auth.getClaims());
      if (error && isAuthRetryableFetchError(error)) throw toProviderError(error);
      const claims = data?.claims;
      if (error || !claims) return null;
      const meta: Record<string, unknown> = claims.user_metadata ?? {};
      return toAuthUser(claims.sub, claims.email, meta);
    },

    async signUpWithPassword({ email, password, displayName, termsVersion, redirectTo }) {
      const { error } = await call(() =>
        auth.signUp({
          email,
          password,
          options: { emailRedirectTo: redirectTo, data: { display_name: displayName, terms_version: termsVersion } },
        }),
      );
      // Already registered: answer as for a new address, so the reply does not reveal it.
      if (error && !isAlreadyRegistered(error)) throw toProviderError(error);
    },

    async resendConfirmation({ email, redirectTo }) {
      const { error } = await call(() => auth.resend({ type: "signup", email, options: { emailRedirectTo: redirectTo } }));
      if (error) throw toProviderError(error);
    },

    async signInWithPassword({ email, password }) {
      const { error } = await call(() => auth.signInWithPassword({ email, password }));
      if (!error) return { ok: true };
      if (error.code === "invalid_credentials" || /invalid login credentials/i.test(error.message)) {
        return { ok: false, reason: "invalid_credentials" };
      }
      if (error.code === "email_not_confirmed" || /email not confirmed/i.test(error.message)) {
        return { ok: false, reason: "email_not_confirmed" };
      }
      throw toProviderError(error);
    },

    async startGoogleSignIn({ redirectTo }) {
      const { data, error } = await call(() =>
        auth.signInWithOAuth({ provider: "google", options: { redirectTo, skipBrowserRedirect: true } }),
      );
      if (error || !data.url) throw toProviderError(error);
      return { url: data.url };
    },

    async completeOAuth(code) {
      const { error } = await call(() => auth.exchangeCodeForSession(code));
      return !error;
    },

    async confirmEmailToken({ tokenHash, type }) {
      const { error } = await call(() => auth.verifyOtp({ token_hash: tokenHash, type }));
      return !error;
    },

    async sendPasswordReset({ email, redirectTo }) {
      const { error } = await call(() => auth.resetPasswordForEmail(email, { redirectTo }));
      if (error) throw toProviderError(error);
    },

    async updatePassword(newPassword) {
      const { error } = await call(() => auth.updateUser({ password: newPassword }));
      if (error) throw toProviderError(error);
    },

    async acceptTerms({ termsVersion }) {
      const now = new Date().toISOString();
      await updateMetadata({ terms_version: termsVersion, terms_accepted_at: now, age_confirmed_at: now });
    },

    async updateDisplayName(name) {
      await updateMetadata({ display_name: name });
    },

    async signOut() {
      const { error } = await call(() => auth.signOut());
      // The global sign-out failed (for example offline): still forget the session on this device.
      if (error) await call(() => auth.signOut({ scope: "local" }));
    },
  };
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function toAuthUser(id: string, email: string | undefined, meta: Record<string, unknown>): AuthUser {
  return {
    id,
    email: email ?? "",
    displayName: text(meta.display_name) ?? text(meta.full_name) ?? text(meta.name) ?? "",
    termsVersion: text(meta.terms_version) ?? null,
  };
}

function isAlreadyRegistered(error: { code?: string; message: string }): boolean {
  return (
    error.code === "user_already_exists" ||
    error.code === "email_exists" ||
    /already registered/i.test(error.message)
  );
}

const RATE_LIMIT_CODES = new Set(["over_request_rate_limit", "over_email_send_rate_limit", "over_sms_send_rate_limit"]);

function toProviderError(error: unknown): AuthProviderError {
  if (isAuthError(error)) {
    if (error.status === 429 || (error.code && RATE_LIMIT_CODES.has(error.code))) {
      return new AuthProviderError("rate_limited", "Too many attempts. Try again later.");
    }
    if (isAuthWeakPasswordError(error) || error.code === "weak_password" || error.code === "same_password") {
      return new AuthProviderError("weak_password", "The password does not meet the requirements.");
    }
  }
  return new AuthProviderError("unavailable", "The sign-in service could not complete the request.");
}
