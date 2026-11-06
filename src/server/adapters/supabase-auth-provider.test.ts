import { AuthApiError, AuthRetryableFetchError, AuthSessionMissingError, AuthWeakPasswordError } from "@supabase/supabase-js";
import { afterEach, describe, expect, test, vi } from "vitest";
import { AuthProviderError, type AuthProvider } from "../ports/auth-provider";
import { createSupabaseAuthProvider, type SupabaseAuthClient } from "./supabase-auth-provider";

/*
  The Supabase client is replaced by a stand-in whose methods return what the
  real client returns ({ data, error }), so these tests never touch the network.
*/

const PASSWORD = "correct horse battery";
const TOKEN = "secret-token-hash-123";
const REDIRECT = "http://localhost:3000/auth/callback";

const ok = (data: unknown = {}) => async () => ({ data, error: null });
const fails = (error: Error) => async () => ({ data: { user: null, session: null }, error });

function makeClient(overrides: Partial<Record<keyof SupabaseAuthClient["auth"], unknown>> = {}) {
  const auth = {
    getClaims: vi.fn(ok({ claims: null })),
    signUp: vi.fn(ok({ user: null, session: null })),
    resend: vi.fn(ok({ user: null, session: null })),
    signInWithPassword: vi.fn(ok({ user: {}, session: {} })),
    signInWithOAuth: vi.fn(ok({ provider: "google", url: "https://accounts.example/authorize" })),
    exchangeCodeForSession: vi.fn(ok({ user: {}, session: {} })),
    verifyOtp: vi.fn(ok({ user: {}, session: {} })),
    resetPasswordForEmail: vi.fn(ok({})),
    updateUser: vi.fn(ok({ user: {} })),
    refreshSession: vi.fn(ok({ user: {}, session: {} })),
    signOut: vi.fn(async () => ({ error: null })),
    ...Object.fromEntries(
      Object.entries(overrides).map(([name, fn]) => [name, vi.isMockFunction(fn) ? fn : vi.fn(fn as () => unknown)]),
    ),
  };
  return { auth } as unknown as SupabaseAuthClient & { auth: Record<string, ReturnType<typeof vi.fn>> };
}

function make(client = makeClient()) {
  const provider = createSupabaseAuthProvider(
    { url: "https://example.supabase.co", anonKey: "anon", cookies: { getAll: () => [], setAll: () => {} } },
    client,
  );
  return { provider, client };
}

const rateLimited = new AuthApiError("Request rate limit reached", 429, "over_request_rate_limit");
const overEmailQuota = new AuthApiError("Email rate limit exceeded", 400, "over_email_send_rate_limit");
const network = new AuthRetryableFetchError("fetch failed", 0);
const serverDown = new AuthRetryableFetchError("Bad Gateway", 502);

const signUpInput = {
  email: "ada@example.com",
  password: PASSWORD,
  displayName: "Ada",
  termsVersion: "2026-11",
  redirectTo: REDIRECT,
};

/** Every call that talks to Supabase and has no "expected failure" result of its own. */
const throwingCalls: [string, keyof SupabaseAuthClient["auth"], (p: AuthProvider) => Promise<unknown>][] = [
  ["signUpWithPassword", "signUp", (p) => p.signUpWithPassword(signUpInput)],
  ["resendConfirmation", "resend", (p) => p.resendConfirmation({ email: "ada@example.com", redirectTo: REDIRECT })],
  ["signInWithPassword", "signInWithPassword", (p) => p.signInWithPassword({ email: "ada@example.com", password: PASSWORD })],
  ["startGoogleSignIn", "signInWithOAuth", (p) => p.startGoogleSignIn({ redirectTo: REDIRECT })],
  ["sendPasswordReset", "resetPasswordForEmail", (p) => p.sendPasswordReset({ email: "ada@example.com", redirectTo: REDIRECT })],
  ["updatePassword", "updateUser", (p) => p.updatePassword(PASSWORD)],
  ["acceptTerms", "updateUser", (p) => p.acceptTerms({ termsVersion: "2026-11" })],
  ["updateDisplayName", "updateUser", (p) => p.updateDisplayName("Ada")],
];

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to throw");
}

afterEach(() => vi.restoreAllMocks());

describe("signInWithPassword", () => {
  test("succeeds and passes the credentials through", async () => {
    const { provider, client } = make();
    expect(await provider.signInWithPassword({ email: "ada@example.com", password: PASSWORD })).toEqual({ ok: true });
    expect(client.auth.signInWithPassword).toHaveBeenCalledWith({ email: "ada@example.com", password: PASSWORD });
  });

  test("an invalid login maps to invalid_credentials", async () => {
    const { provider } = make(
      makeClient({ signInWithPassword: fails(new AuthApiError("Invalid login credentials", 400, "invalid_credentials")) }),
    );
    expect(await provider.signInWithPassword({ email: "ada@example.com", password: "nope" })).toEqual({
      ok: false,
      reason: "invalid_credentials",
    });
  });

  test('"Email not confirmed" maps to email_not_confirmed', async () => {
    const { provider } = make(
      makeClient({ signInWithPassword: fails(new AuthApiError("Email not confirmed", 400, "email_not_confirmed")) }),
    );
    expect(await provider.signInWithPassword({ email: "ada@example.com", password: PASSWORD })).toEqual({
      ok: false,
      reason: "email_not_confirmed",
    });
  });

  test("the messages are recognised even without an error code", async () => {
    const invalid = make(makeClient({ signInWithPassword: fails(new AuthApiError("Invalid login credentials", 400, undefined)) }));
    const unconfirmed = make(makeClient({ signInWithPassword: fails(new AuthApiError("Email not confirmed", 400, undefined)) }));
    const input = { email: "ada@example.com", password: PASSWORD };
    expect(await invalid.provider.signInWithPassword(input)).toEqual({ ok: false, reason: "invalid_credentials" });
    expect(await unconfirmed.provider.signInWithPassword(input)).toEqual({ ok: false, reason: "email_not_confirmed" });
  });
});

describe("errors map to AuthProviderError", () => {
  test.each(throwingCalls)("%s: a 429 response is rate_limited", async (_name, method, call) => {
    const { provider } = make(makeClient({ [method]: fails(rateLimited) }));
    const error = await caught(call(provider));
    expect(error).toBeInstanceOf(AuthProviderError);
    expect((error as AuthProviderError).code).toBe("rate_limited");
  });

  test.each(throwingCalls)("%s: an over-quota response is rate_limited", async (_name, method, call) => {
    const { provider } = make(makeClient({ [method]: fails(overEmailQuota) }));
    expect(((await caught(call(provider))) as AuthProviderError).code).toBe("rate_limited");
  });

  test.each(throwingCalls)("%s: a network failure is unavailable", async (_name, method, call) => {
    for (const failure of [network, serverDown]) {
      const { provider } = make(makeClient({ [method]: fails(failure) }));
      expect(((await caught(call(provider))) as AuthProviderError).code).toBe("unavailable");
    }
  });

  test.each(throwingCalls)("%s: a client that throws is unavailable", async (_name, method, call) => {
    const { provider } = make(
      makeClient({
        [method]: async () => {
          throw new TypeError("fetch failed");
        },
      }),
    );
    expect(((await caught(call(provider))) as AuthProviderError).code).toBe("unavailable");
  });

  test.each([
    ["signUpWithPassword", "signUp", (p: AuthProvider) => p.signUpWithPassword(signUpInput)],
    ["updatePassword", "updateUser", (p: AuthProvider) => p.updatePassword("short")],
  ] as const)("%s: a password-policy error is weak_password", async (_name, method, call) => {
    for (const failure of [
      new AuthWeakPasswordError("Password should be at least 8 characters.", 422, ["length"]),
      new AuthApiError("Password is too weak", 422, "weak_password"),
    ]) {
      const { provider } = make(makeClient({ [method]: fails(failure) }));
      expect(((await caught(call(provider))) as AuthProviderError).code).toBe("weak_password");
    }
  });

  test("no error message or log line contains a password or token", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const leaky = new AuthApiError(`bad input ${PASSWORD} ${TOKEN}`, 500, "unexpected_failure");
    const messages: string[] = [];
    for (const [, method, call] of throwingCalls) {
      const { provider } = make(makeClient({ [method]: fails(leaky) }));
      const error = (await caught(call(provider))) as Error;
      messages.push(error.message, String(error.stack));
    }
    const { provider } = make(makeClient({ verifyOtp: fails(leaky), exchangeCodeForSession: fails(leaky) }));
    await provider.confirmEmailToken({ tokenHash: TOKEN, type: "email" }).catch((e: Error) => messages.push(e.message));
    await provider.completeOAuth(TOKEN).catch((e: Error) => messages.push(e.message));

    const logged = [...log.mock.calls, ...warn.mock.calls, ...err.mock.calls].flat().map(String);
    for (const text of [...messages, ...logged]) {
      expect(text).not.toContain(PASSWORD);
      expect(text).not.toContain(TOKEN);
    }
  });
});

describe("signUpWithPassword", () => {
  test("passes the redirect and the profile metadata", async () => {
    const { provider, client } = make();
    await provider.signUpWithPassword(signUpInput);
    expect(client.auth.signUp).toHaveBeenCalledWith({
      email: "ada@example.com",
      password: PASSWORD,
      options: {
        emailRedirectTo: REDIRECT,
        data: { display_name: "Ada", terms_version: "2026-11" },
      },
    });
  });

  test("an already registered address returns normally", async () => {
    for (const failure of [
      new AuthApiError("User already registered", 422, "user_already_exists"),
      new AuthApiError("User already registered", 422, undefined),
      new AuthApiError("Email address already exists", 422, "email_exists"),
    ]) {
      const { provider } = make(makeClient({ signUp: fails(failure) }));
      await expect(provider.signUpWithPassword(signUpInput)).resolves.toBeUndefined();
    }
  });
});

describe("getUser", () => {
  const claims = (user_metadata: Record<string, unknown>) =>
    ok({ claims: { sub: "user-1", email: "ada@example.com", user_metadata }, header: {}, signature: new Uint8Array() });

  test("uses getClaims and maps user_metadata to AuthUser", async () => {
    const { provider, client } = make(makeClient({ getClaims: claims({ display_name: "Ada", terms_version: "2026-11" }) }));
    expect(await provider.getUser()).toEqual({
      id: "user-1",
      email: "ada@example.com",
      displayName: "Ada",
      termsVersion: "2026-11",
    });
    expect(client.auth.getClaims).toHaveBeenCalled();
  });

  test("falls back to full_name (Google) and to no terms version", async () => {
    const { provider } = make(makeClient({ getClaims: claims({ full_name: "Ada Lovelace" }) }));
    expect(await provider.getUser()).toEqual({
      id: "user-1",
      email: "ada@example.com",
      displayName: "Ada Lovelace",
      termsVersion: null,
    });
  });

  test("ignores metadata values that are not strings", async () => {
    const { provider } = make(makeClient({ getClaims: claims({ display_name: 42, full_name: "Ada", terms_version: false }) }));
    expect(await provider.getUser()).toMatchObject({ displayName: "Ada", termsVersion: null });
  });

  test("returns null when there is no session", async () => {
    expect(await make().provider.getUser()).toBeNull();
    const missing = make(makeClient({ getClaims: async () => ({ data: null, error: new AuthSessionMissingError() }) }));
    expect(await missing.provider.getUser()).toBeNull();
  });

  test("a network failure is unavailable", async () => {
    const { provider } = make(makeClient({ getClaims: async () => ({ data: null, error: network }) }));
    expect(((await caught(provider.getUser())) as AuthProviderError).code).toBe("unavailable");
  });
});

describe("other operations", () => {
  test("resendConfirmation resends the sign-up email with the redirect", async () => {
    const { provider, client } = make();
    await provider.resendConfirmation({ email: "ada@example.com", redirectTo: REDIRECT });
    expect(client.auth.resend).toHaveBeenCalledWith({
      type: "signup",
      email: "ada@example.com",
      options: { emailRedirectTo: REDIRECT },
    });
  });

  test('startGoogleSignIn passes provider "google" and the redirectTo, and returns the URL', async () => {
    const { provider, client } = make();
    expect(await provider.startGoogleSignIn({ redirectTo: REDIRECT })).toEqual({
      url: "https://accounts.example/authorize",
    });
    expect(client.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: REDIRECT, skipBrowserRedirect: true },
    });
  });

  test("completeOAuth exchanges the code and reports success", async () => {
    const { provider, client } = make();
    expect(await provider.completeOAuth("code-1")).toBe(true);
    expect(client.auth.exchangeCodeForSession).toHaveBeenCalledWith("code-1");
    const bad = make(makeClient({ exchangeCodeForSession: fails(new AuthApiError("invalid flow state", 404, "flow_state_not_found")) }));
    expect(await bad.provider.completeOAuth("code-1")).toBe(false);
  });

  test.each(["email", "recovery"] as const)("confirmEmailToken calls verifyOtp with the token hash and type %s", async (type) => {
    const { provider, client } = make();
    expect(await provider.confirmEmailToken({ tokenHash: TOKEN, type })).toBe(true);
    expect(client.auth.verifyOtp).toHaveBeenCalledWith({ token_hash: TOKEN, type });
  });

  test("confirmEmailToken returns false on error", async () => {
    const { provider } = make(
      makeClient({ verifyOtp: fails(new AuthApiError("Email link is invalid or has expired", 403, "otp_expired")) }),
    );
    expect(await provider.confirmEmailToken({ tokenHash: TOKEN, type: "email" })).toBe(false);
  });

  test("sendPasswordReset sends the reset email with the redirect", async () => {
    const { provider, client } = make();
    await provider.sendPasswordReset({ email: "ada@example.com", redirectTo: REDIRECT });
    expect(client.auth.resetPasswordForEmail).toHaveBeenCalledWith("ada@example.com", { redirectTo: REDIRECT });
  });

  test("updatePassword sets the new password", async () => {
    const { provider, client } = make();
    await provider.updatePassword(PASSWORD);
    expect(client.auth.updateUser).toHaveBeenCalledWith({ password: PASSWORD });
  });

  test("acceptTerms writes terms_version, terms_accepted_at and age_confirmed_at into user metadata", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-06T10:00:00.000Z") });
    try {
      const { provider, client } = make();
      await provider.acceptTerms({ termsVersion: "2026-11" });
      expect(client.auth.updateUser).toHaveBeenCalledWith({
        data: {
          terms_version: "2026-11",
          terms_accepted_at: "2026-11-06T10:00:00.000Z",
          age_confirmed_at: "2026-11-06T10:00:00.000Z",
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  test("metadata changes refresh the session, so getUser (which reads the token) sees them", async () => {
    const { provider, client } = make();
    await provider.acceptTerms({ termsVersion: "2026-11" });
    await provider.updateDisplayName("Ada");
    expect(client.auth.refreshSession).toHaveBeenCalledTimes(2);
  });

  test("updateDisplayName writes display_name into user metadata", async () => {
    const { provider, client } = make();
    await provider.updateDisplayName("Ada L");
    expect(client.auth.updateUser).toHaveBeenCalledWith({ data: { display_name: "Ada L" } });
  });

  test("signOut signs out, and still clears this device if the server cannot be reached", async () => {
    const { provider, client } = make();
    await provider.signOut();
    expect(client.auth.signOut).toHaveBeenCalledTimes(1);

    const offline = make(makeClient({ signOut: vi.fn(async () => ({ error: network })) }));
    await offline.provider.signOut();
    expect(offline.client.auth.signOut).toHaveBeenLastCalledWith({ scope: "local" });
  });
});
