import { randomBytes } from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import {
  AuthUnknownError,
  createClient,
  isAuthError,
  isAuthRetryableFetchError,
  isAuthWeakPasswordError,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { AuthProviderError, type AuthProvider, type AuthUser, type VerifyCodeResult } from "../ports/auth-provider";
import { authCookieOptions, siteUsesHttps } from "./supabase-auth-cookies";

/*
  Supabase Auth behind our AuthProvider port. Create one provider per request:
  the server client keeps the session in the request's cookies, and Supabase
  only hands out the no-cache headers on the first cookie write of a client.

  Supabase's own error messages are never passed on or logged, because a
  message could echo what was sent. Our errors carry only a fixed message.

  Code facts this relies on (checked live on the dev project, Task 1): verifyOtp with
  type "signup" accepts a sign-up code and "recovery" a recovery code, both returning a
  session; a wrong, used, superseded or expired code all answer 403 otp_expired.

  Password facts (checked live, Task 3 fix round, probes k to n):
  - admin updateUserById({ password }) (scramblePassword): the auth server rejects the tokens
    of EVERY session of the user, the caller's too (refresh refused, access token refused at
    the server; the access JWT itself stays valid until it expires), and outstanding codes
    stop working;
  - updateUser({ password }) from a code session works and keeps that session; the server
    rejects the user's other sessions' tokens even without signOut(others), and outstanding
    codes stop working;
  - updateUser({ password }) from a password sign-in session answers 400
    current_password_required and changes nothing (mapped to unavailable);
  - a second signUp, resend or resetPasswordForEmail to one address 3 s after the first
    answers 429 over_email_send_rate_limit (mapped to rate_limited).
  - (probes p, q) after a scramble, admin generateLink({ type: "recovery" }) returns the code
    in its response (no email; recovery_sent_at is set) and verifyOtp with it on a
    cookie-bound client stores a working session (getUser, refresh, updateUser all work),
    with or without an earlier password: openSessionWithoutEmail.
*/

export type CookieJar = {
  getAll(): { name: string; value: string }[];
  setAll(items: { name: string; value: string; options?: object }[]): void;
};

/** The part of the Supabase client this adapter uses. Tests pass a stand-in. */
export type SupabaseAuthClient = Pick<SupabaseClient, "auth">;

/** The part of the service-role (admin) client this adapter uses. Tests pass a stand-in. */
export type SupabaseAdminClient = {
  auth: { admin: Pick<SupabaseClient["auth"]["admin"], "updateUserById" | "generateLink"> };
};

const INVALID_CODE: VerifyCodeResult = { ok: false, reason: "invalid_or_expired" };

/** Random bytes behind a scrambled password: 256 bits, sent as 43 base64url characters. */
const SCRAMBLED_PASSWORD_BYTES = 32;
/** Fixed suffix so any password policy (lower, upper, digit, symbol) accepts the random value. */
const POLICY_SUFFIX = "!aA1";

export function createSupabaseAuthProvider(
  deps: {
    url: string;
    anonKey: string;
    cookies: CookieJar;
    /** Mark the session cookies Secure. Defaults to whether the site address is https. */
    secureCookies?: boolean;
    /** Service role key, used only by scramblePassword. Without it that method is unavailable. */
    serviceRoleKey?: string;
  },
  client?: SupabaseAuthClient,
  adminClient?: SupabaseAdminClient,
): AuthProvider {
  const { auth } =
    client ??
    createServerClient(deps.url, deps.anonKey, {
      cookieOptions: authCookieOptions(deps.secureCookies ?? siteUsesHttps()),
      cookies: {
        getAll: () => deps.cookies.getAll(),
        setAll: (items) => deps.cookies.setAll(items),
      },
    });

  /**
   * The admin client, made on first use. It keeps no session and never sees the request's
   * cookies: it acts with the service role key only, never as the signed-in person.
   */
  let admin = adminClient;
  function getAdmin(): SupabaseAdminClient {
    if (admin) return admin;
    if (!deps.serviceRoleKey) throw new AuthProviderError("unavailable", "The account service is not configured.");
    admin = createClient(deps.url, deps.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    return admin;
  }

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
      const data = { display_name: displayName, terms_version: termsVersion };
      // redirectTo is the deprecated link flow; without it the email carries the code only.
      const options = redirectTo ? { emailRedirectTo: redirectTo, data } : { data };
      const result = await call(() => auth.signUp({ email, password, options }));
      if (result.error) {
        // Already registered: answer as for a new address. No id is known; callers ask the AccountDirectory.
        if (isAlreadyRegistered(result.error)) return { userId: "" };
        throw toProviderError(result.error);
      }
      // For a confirmed address Supabase answers with an obfuscated stand-in user; its id is
      // returned as is and means nothing on its own (see the port).
      return { userId: result.data.user?.id ?? "" };
    },

    async resendSignUpCode({ email }) {
      const { error } = await call(() => auth.resend({ type: "signup", email }));
      if (error) throw toProviderError(error);
    },

    async sendPasswordResetCode({ email }) {
      const { error } = await call(() => auth.resetPasswordForEmail(email));
      if (error) throw toProviderError(error);
    },

    async verifyCode({ email, code, kind }) {
      const { data, error } = await call(() => auth.verifyOtp({ email, token: code, type: kind }));
      if (error) {
        // A limit or an outage is not a wrong code: say so, so the person is not told to retype it.
        if (isRateLimited(error) || isOutage(error)) throw toProviderError(error);
        return INVALID_CODE;
      }
      if (!data.user || !data.session) return INVALID_CODE;
      return { ok: true, userId: data.user.id };
    },

    async scramblePassword(userId) {
      const adminApi = getAdmin().auth.admin;
      // Kept only in this call's scope: never returned, logged or stored.
      const { error } = await call(() =>
        adminApi.updateUserById(userId, {
          password: `${randomBytes(SCRAMBLED_PASSWORD_BYTES).toString("base64url")}${POLICY_SUFFIX}`,
        }),
      );
      if (error) throw toProviderError(error);
    },

    /** Server only, right after the request proved ownership (see the port). Never logs the code. */
    async openSessionWithoutEmail({ email, expectedUserId }) {
      const adminApi = getAdmin().auth.admin;
      // The admin client makes a recovery code and returns it instead of emailing it (probe p).
      const link = await call(() => adminApi.generateLink({ type: "recovery", email }));
      if (link.error) throw toProviderError(link.error);
      const code = link.data.properties?.email_otp;
      if (!code) throw new AuthProviderError("unavailable", "The sign-in service could not complete the request.");
      // Redeemed on the cookie-bound client, so the new session is stored in this browser.
      const { data, error } = await call(() => auth.verifyOtp({ email, token: code, type: "recovery" }));
      if (error) throw toProviderError(error);
      if (!data.user || !data.session) throw new AuthProviderError("unavailable", "The sign-in service could not complete the request.");
      if (data.user.id !== expectedUserId) {
        // The address belongs to someone other than the user the caller proved: end just this
        // new session (at the server and in the cookies) and name neither id.
        await call(() => auth.signOut({ scope: "local" })).catch(() => {});
        throw new AuthProviderError("unavailable", "The sign-in service could not complete the request.");
      }
      return { userId: data.user.id };
    },

    /** @deprecated Link flow; Task 5 removes it. */
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
        auth.signInWithOAuth({
          provider: "google",
          // Google shows its account chooser every time, so a shared device never signs in as the wrong person.
          options: { redirectTo, skipBrowserRedirect: true, queryParams: { prompt: "select_account" } },
        }),
      );
      if (error || !data.url) throw toProviderError(error);
      return { url: data.url };
    },

    async completeOAuth(code) {
      const { error } = await call(() => auth.exchangeCodeForSession(code));
      return !error;
    },

    /** @deprecated Link flow; Task 5 removes it. */
    async confirmEmailToken({ tokenHash, type }) {
      const { error } = await call(() => auth.verifyOtp({ token_hash: tokenHash, type }));
      return !error;
    },

    /** @deprecated Link flow; Task 5 removes it. */
    async sendPasswordReset({ email, redirectTo }) {
      const { error } = await call(() => auth.resetPasswordForEmail(email, { redirectTo }));
      if (error) throw toProviderError(error);
    },

    async updatePassword(newPassword, opts) {
      const { error } = await call(() => auth.updateUser({ password: newPassword }));
      if (error) throw toProviderError(error);
      if (!opts?.signOutOthers) return;
      // GoTrue already ended the other sessions with the password change (probe l2); this asks
      // for it explicitly, so the promise does not rest on that. If it fails the password is
      // already changed, and the caller is told (unavailable).
      const others = await call(() => auth.signOut({ scope: "others" }));
      if (others.error) throw toProviderError(others.error);
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
    // Google's claims, which Supabase merges into the metadata when the identity signs in or links.
    providerName: text(meta.full_name) ?? text(meta.name) ?? null,
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

function isRateLimited(error: unknown): boolean {
  return isAuthError(error) && (error.status === 429 || (!!error.code && RATE_LIMIT_CODES.has(error.code)));
}

/** The service could not be reached or failed on its side (as opposed to refusing the request). */
function isOutage(error: unknown): boolean {
  return (
    isAuthRetryableFetchError(error) ||
    error instanceof AuthUnknownError ||
    (isAuthError(error) && (error.status ?? 0) >= 500)
  );
}

function toProviderError(error: unknown): AuthProviderError {
  if (isAuthError(error)) {
    if (isRateLimited(error)) {
      return new AuthProviderError("rate_limited", "Too many attempts. Try again later.");
    }
    if (isAuthWeakPasswordError(error) || error.code === "weak_password" || error.code === "same_password") {
      return new AuthProviderError("weak_password", "The password does not meet the requirements.");
    }
  }
  return new AuthProviderError("unavailable", "The sign-in service could not complete the request.");
}
