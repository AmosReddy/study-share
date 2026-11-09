import {
  AuthApiError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
  AuthUnknownError,
  AuthWeakPasswordError,
} from "@supabase/supabase-js";
import { afterEach, describe, expect, test, vi } from "vitest";
import { AuthProviderError, type AuthProvider } from "../ports/auth-provider";
import { createSupabaseAuthProvider, type SupabaseAdminClient, type SupabaseAuthClient } from "./supabase-auth-provider";

/*
  The Supabase client is replaced by a stand-in whose methods return what the
  real client returns ({ data, error }), so these tests never touch the network.
*/

const PASSWORD = "correct horse battery";
const TOKEN = "secret-token-hash-123";
const CODE = "482913";
const USER_ID = "6aa5d0d4-2a9f-4483-b6c8-0cf4c6c98ac4";
const REDIRECT = "http://localhost:3000/auth/callback";

const ok = (data: unknown = {}) => async () => ({ data, error: null });
const fails = (error: Error) => async () => ({ data: { user: null, session: null }, error });

function makeClient(overrides: Partial<Record<keyof SupabaseAuthClient["auth"], unknown>> = {}) {
  const auth = {
    getClaims: vi.fn(ok({ claims: null })),
    signUp: vi.fn(ok({ user: { id: "user-1" }, session: null })),
    resend: vi.fn(ok({ user: null, session: null })),
    signInWithPassword: vi.fn(ok({ user: {}, session: {} })),
    signInWithOAuth: vi.fn(ok({ provider: "google", url: "https://accounts.example/authorize" })),
    exchangeCodeForSession: vi.fn(ok({ user: {}, session: {} })),
    verifyOtp: vi.fn(ok({ user: { id: "user-1" }, session: { access_token: "a", refresh_token: "r" } })),
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

const MINT_CODE = "771144";

function makeAdmin(
  updateUserById: unknown = ok({ user: { id: USER_ID } }),
  generateLink: unknown = ok({ properties: { email_otp: MINT_CODE, hashed_token: TOKEN }, user: { id: USER_ID } }),
) {
  const asMock = (f: unknown) => (vi.isMockFunction(f) ? f : vi.fn(f as () => unknown));
  return { auth: { admin: { updateUserById: asMock(updateUserById), generateLink: asMock(generateLink) } } } as unknown as SupabaseAdminClient & {
    auth: { admin: { updateUserById: ReturnType<typeof vi.fn>; generateLink: ReturnType<typeof vi.fn> } };
  };
}

function make(client = makeClient(), admin = makeAdmin()) {
  const provider = createSupabaseAuthProvider(
    {
      url: "https://example.supabase.co",
      anonKey: "anon",
      serviceRoleKey: "service-role",
      cookies: { getAll: () => [], setAll: () => {} },
    },
    client,
    admin,
  );
  return { provider, client, admin };
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
};

/** Every call that talks to Supabase and has no "expected failure" result of its own. */
const throwingCalls: [string, keyof SupabaseAuthClient["auth"], (p: AuthProvider) => Promise<unknown>][] = [
  ["signUpWithPassword", "signUp", (p) => p.signUpWithPassword(signUpInput)],
  ["signInWithPassword", "signInWithPassword", (p) => p.signInWithPassword({ email: "ada@example.com", password: PASSWORD })],
  ["startGoogleSignIn", "signInWithOAuth", (p) => p.startGoogleSignIn({ redirectTo: REDIRECT })],
  ["updatePassword", "updateUser", (p) => p.updatePassword(PASSWORD)],
  ["acceptTerms", "updateUser", (p) => p.acceptTerms({ termsVersion: "2026-11" })],
  ["updateDisplayName", "updateUser", (p) => p.updateDisplayName("Ada")],
  ["clearTermsAcceptance", "updateUser", (p) => p.clearTermsAcceptance()],
  ["resendSignUpCode", "resend", (p) => p.resendSignUpCode({ email: "ada@example.com" })],
  ["sendPasswordResetCode", "resetPasswordForEmail", (p) => p.sendPasswordResetCode({ email: "ada@example.com" })],
  ["updatePassword (signOutOthers)", "signOut", (p) => p.updatePassword(PASSWORD, { signOutOthers: true })],
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
    await provider.verifyCode({ email: "ada@example.com", code: "123456", kind: "signup" }).catch((e: Error) => messages.push(e.message));
    await provider.completeOAuth(TOKEN).catch((e: Error) => messages.push(e.message));

    const logged = [...log.mock.calls, ...warn.mock.calls, ...err.mock.calls].flat().map(String);
    for (const text of [...messages, ...logged]) {
      expect(text).not.toContain(PASSWORD);
      expect(text).not.toContain(TOKEN);
    }
  });
});

describe("signUpWithPassword", () => {
  test("passes the profile metadata and no emailRedirectTo (the email carries a code only)", async () => {
    const { provider, client } = make();
    await provider.signUpWithPassword(signUpInput);
    expect(client.auth.signUp).toHaveBeenCalledWith({
      email: "ada@example.com",
      password: PASSWORD,
      options: { data: { display_name: "Ada", terms_version: "2026-11" } },
    });
  });

  test("an already registered address returns normally", async () => {
    for (const failure of [
      new AuthApiError("User already registered", 422, "user_already_exists"),
      new AuthApiError("User already registered", 422, undefined),
      new AuthApiError("Email address already exists", 422, "email_exists"),
    ]) {
      const { provider } = make(makeClient({ signUp: fails(failure) }));
      // No id is known here; the caller asks the AccountDirectory for the address's state.
      await expect(provider.signUpWithPassword(signUpInput)).resolves.toEqual({ userId: "" });
    }
  });

  test("returns the pending user's id from the response", async () => {
    const { provider } = make();
    expect(await provider.signUpWithPassword(signUpInput)).toEqual({ userId: "user-1" });
  });

  test("returns the obfuscated id Supabase answers for an already-confirmed address", async () => {
    const { provider } = make(makeClient({ signUp: ok({ user: { id: "obfuscated-id", identities: [] }, session: null }) }));
    expect(await provider.signUpWithPassword(signUpInput)).toEqual({ userId: "obfuscated-id" });
  });
});

describe("verifyCode", () => {
  test.each(["signup", "recovery"] as const)("calls verifyOtp with { email, token, type: %s } and returns the user id", async (kind) => {
    const { provider, client } = make();
    expect(await provider.verifyCode({ email: "ada@example.com", code: CODE, kind })).toEqual({ ok: true, userId: "user-1" });
    expect(client.auth.verifyOtp).toHaveBeenCalledWith({ email: "ada@example.com", token: CODE, type: kind });
  });

  test("every code failure is invalid_or_expired, with no vendor text", async () => {
    for (const failure of [
      new AuthApiError("Token has expired or is invalid", 403, "otp_expired"),
      new AuthApiError("Token has expired or is invalid", 403, undefined),
      new AuthApiError(`bad ${CODE} for ada@example.com`, 400, "validation_failed"),
      new AuthApiError("User not found", 404, "user_not_found"),
    ]) {
      const { provider } = make(makeClient({ verifyOtp: fails(failure) }));
      const result = await provider.verifyCode({ email: "ada@example.com", code: CODE, kind: "signup" });
      expect(result).toEqual({ ok: false, reason: "invalid_or_expired" });
      expect(JSON.stringify(result)).not.toMatch(/token|expired or|ada@|validation|otp/i);
    }
  });

  test("a success with no user or session is not reported as signed in", async () => {
    const { provider } = make(makeClient({ verifyOtp: ok({ user: null, session: null }) }));
    expect(await provider.verifyCode({ email: "ada@example.com", code: CODE, kind: "signup" })).toEqual({
      ok: false,
      reason: "invalid_or_expired",
    });
  });

  test("a rate limit is rate_limited and an outage is unavailable, not a wrong code", async () => {
    const limited = make(makeClient({ verifyOtp: fails(rateLimited) }));
    expect(((await caught(limited.provider.verifyCode({ email: "a@x.com", code: CODE, kind: "signup" }))) as AuthProviderError).code).toBe(
      "rate_limited",
    );
    for (const failure of [network, serverDown]) {
      const down = make(makeClient({ verifyOtp: fails(failure) }));
      expect(((await caught(down.provider.verifyCode({ email: "a@x.com", code: CODE, kind: "signup" }))) as AuthProviderError).code).toBe(
        "unavailable",
      );
    }
    const throwing = make(
      makeClient({
        verifyOtp: async () => {
          throw new TypeError("fetch failed");
        },
      }),
    );
    expect(((await caught(throwing.provider.verifyCode({ email: "a@x.com", code: CODE, kind: "recovery" }))) as AuthProviderError).code).toBe(
      "unavailable",
    );
  });

  test("an unknown error (a response that could not be read) is unavailable, not a wrong code", async () => {
    const { provider } = make(makeClient({ verifyOtp: fails(new AuthUnknownError("bad response", new Error("x"))) }));
    expect(((await caught(provider.verifyCode({ email: "a@x.com", code: CODE, kind: "signup" }))) as AuthProviderError).code).toBe(
      "unavailable",
    );
  });
});

describe("code emails", () => {
  test('resendSignUpCode calls resend({ type: "signup", email }) with no redirect', async () => {
    const { provider, client } = make();
    await expect(provider.resendSignUpCode({ email: "ada@example.com" })).resolves.toBeUndefined();
    expect(client.auth.resend).toHaveBeenCalledWith({ type: "signup", email: "ada@example.com" });
  });

  test("sendPasswordResetCode calls resetPasswordForEmail without a redirect", async () => {
    const { provider, client } = make();
    await expect(provider.sendPasswordResetCode({ email: "ada@example.com" })).resolves.toBeUndefined();
    expect(client.auth.resetPasswordForEmail).toHaveBeenCalledWith("ada@example.com");
  });
});

describe("updatePassword", () => {
  test("with signOutOthers it calls updateUser, then signOut({ scope: others })", async () => {
    const { provider, client } = make();
    await provider.updatePassword(PASSWORD, { signOutOthers: true });
    expect(client.auth.updateUser).toHaveBeenCalledWith({ password: PASSWORD });
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: "others" });
    const order = (fn: unknown) => vi.mocked(fn as () => unknown).mock.invocationCallOrder[0];
    expect(order(client.auth.updateUser)).toBeLessThan(order(client.auth.signOut));
  });

  test("without the option it does not sign out other devices", async () => {
    const { provider, client } = make();
    await provider.updatePassword(PASSWORD);
    await provider.updatePassword(PASSWORD, { signOutOthers: false });
    expect(client.auth.signOut).not.toHaveBeenCalled();
  });

  test("current_password_required (a password sign-in session) is reauth_required, with no vendor text", async () => {
    const refused = new AuthApiError("Current password required when setting new password.", 400, "current_password_required");
    const { provider, client } = make(makeClient({ updateUser: fails(refused) }));
    const error = (await caught(provider.updatePassword(PASSWORD, { signOutOthers: true }))) as AuthProviderError;
    expect(error.code).toBe("reauth_required");
    expect(error.message).not.toMatch(/current password/i);
    expect(client.auth.signOut).not.toHaveBeenCalled();
  });

  test("a failed password change signs nobody out", async () => {
    const { provider, client } = make(makeClient({ updateUser: fails(rateLimited) }));
    await caught(provider.updatePassword(PASSWORD, { signOutOthers: true }));
    expect(client.auth.signOut).not.toHaveBeenCalled();
  });
});

describe("openSessionWithoutEmail", () => {
  test("asks the admin client for a recovery code, then verifies it on the cookie client, and returns the user id", async () => {
    const { provider, client, admin } = make();
    expect(await provider.openSessionWithoutEmail({ email: "ada@example.com", expectedUserId: "user-1" })).toEqual({ userId: "user-1" });
    expect(admin.auth.admin.generateLink).toHaveBeenCalledWith({ type: "recovery", email: "ada@example.com" });
    expect(client.auth.verifyOtp).toHaveBeenCalledWith({ email: "ada@example.com", token: MINT_CODE, type: "recovery" });
    const order = (fn: unknown) => vi.mocked(fn as () => unknown).mock.invocationCallOrder[0];
    expect(order(admin.auth.admin.generateLink)).toBeLessThan(order(client.auth.verifyOtp));
    // No email is sent by any other call.
    expect(client.auth.resetPasswordForEmail).not.toHaveBeenCalled();
    expect(client.auth.resend).not.toHaveBeenCalled();
  });

  test("a session for a user other than expectedUserId is signed out (this session only) and is unavailable, naming no id", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const { provider, client } = make(
      makeClient({ verifyOtp: ok({ user: { id: "someone-else-id" }, session: { access_token: "a", refresh_token: "r" } }) }),
    );
    const error = (await caught(provider.openSessionWithoutEmail({ email: "ada@example.com", expectedUserId: "user-1" }))) as AuthProviderError;
    expect(error).toBeInstanceOf(AuthProviderError);
    expect(error.code).toBe("unavailable");
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    const texts = [error.message, String(error.stack), ...spies.flatMap((s) => s.mock.calls.flat().map(String))];
    for (const text of texts) {
      expect(text).not.toContain("someone-else-id");
      expect(text).not.toContain("user-1");
    }
  });

  test("the matching user is not signed out", async () => {
    const { provider, client } = make();
    await provider.openSessionWithoutEmail({ email: "ada@example.com", expectedUserId: "user-1" });
    expect(client.auth.signOut).not.toHaveBeenCalled();
  });

  test("without a service role key it is unavailable and calls nothing", async () => {
    const client = makeClient();
    const provider = createSupabaseAuthProvider(
      { url: "https://example.supabase.co", anonKey: "anon", cookies: { getAll: () => [], setAll: () => {} } },
      client,
    );
    expect(((await caught(provider.openSessionWithoutEmail({ email: "a@x.com", expectedUserId: "user-1" }))) as AuthProviderError).code).toBe("unavailable");
    expect(client.auth.verifyOtp).not.toHaveBeenCalled();
  });

  test("generateLink failures map as elsewhere and stop before verifyOtp", async () => {
    const cases: [unknown, AuthProviderError["code"]][] = [
      [fails(rateLimited), "rate_limited"],
      [fails(network), "unavailable"],
      [fails(new AuthApiError("User not found", 404, "user_not_found")), "unavailable"],
      [ok({ properties: {}, user: null }), "unavailable"],
      [
        async () => {
          throw new TypeError("fetch failed");
        },
        "unavailable",
      ],
    ];
    for (const [generateLink, code] of cases) {
      const { provider, client } = make(makeClient(), makeAdmin(undefined, generateLink));
      expect(((await caught(provider.openSessionWithoutEmail({ email: "a@x.com", expectedUserId: "user-1" }))) as AuthProviderError).code).toBe(code);
      expect(client.auth.verifyOtp).not.toHaveBeenCalled();
    }
  });

  test("a verifyOtp failure, or a reply with no session, is unavailable (rate limits stay rate_limited)", async () => {
    const cases: [unknown, AuthProviderError["code"]][] = [
      [fails(new AuthApiError("Token has expired or is invalid", 403, "otp_expired")), "unavailable"],
      [fails(rateLimited), "rate_limited"],
      [fails(network), "unavailable"],
      [ok({ user: null, session: null }), "unavailable"],
    ];
    for (const [verifyOtp, code] of cases) {
      const { provider } = make(makeClient({ verifyOtp }));
      expect(((await caught(provider.openSessionWithoutEmail({ email: "a@x.com", expectedUserId: "user-1" }))) as AuthProviderError).code).toBe(code);
    }
  });

  test("never logs or returns the code or token, and errors carry no vendor text", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const leaky = new AuthApiError(`bad ${MINT_CODE} ${TOKEN} for ada@example.com`, 500, "unexpected_failure");
    const texts: string[] = [];
    const { provider } = make();
    texts.push(JSON.stringify(await provider.openSessionWithoutEmail({ email: "ada@example.com", expectedUserId: "user-1" })));
    for (const [client, admin] of [
      [makeClient({ verifyOtp: fails(leaky) }), makeAdmin()],
      [makeClient(), makeAdmin(undefined, fails(leaky))],
    ] as const) {
      const e = (await caught(make(client, admin).provider.openSessionWithoutEmail({ email: "ada@example.com", expectedUserId: "user-1" }))) as Error;
      texts.push(e.message, String(e.stack));
    }
    texts.push(...spies.flatMap((s) => s.mock.calls.flat().map(String)));
    for (const text of texts) {
      expect(text).not.toContain(MINT_CODE);
      expect(text).not.toContain(TOKEN);
      expect(text).not.toContain("ada@example.com");
    }
  });
});

describe("resetUserMetadata", () => {
  test("overwrites the name and empties the terms through the admin client, not the person's session", async () => {
    const { provider, admin, client } = make();
    await expect(provider.resetUserMetadata(USER_ID, { displayName: "ada" })).resolves.toBeUndefined();
    expect(admin.auth.admin.updateUserById).toHaveBeenCalledWith(USER_ID, {
      user_metadata: { display_name: "ada", terms_version: null, terms_accepted_at: null, age_confirmed_at: null },
    });
    expect(client.auth.updateUser).not.toHaveBeenCalled();
  });

  test("with acceptedTermsVersion it records that version, accepted now, instead of clearing it", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-09T10:00:00.000Z") });
    try {
      const { provider, admin } = make();
      await provider.resetUserMetadata(USER_ID, { displayName: "Google User", acceptedTermsVersion: "2026-11-06" });
      expect(admin.auth.admin.updateUserById).toHaveBeenCalledWith(USER_ID, {
        user_metadata: {
          display_name: "Google User",
          terms_version: "2026-11-06",
          terms_accepted_at: "2026-11-09T10:00:00.000Z",
          age_confirmed_at: "2026-11-09T10:00:00.000Z",
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  test("a failure is an AuthProviderError with no vendor text, id or name", async () => {
    const { provider } = make(makeClient(), makeAdmin(fails(new AuthApiError("User not found for 6aa5 ada", 404, "user_not_found"))));
    const error = (await caught(provider.resetUserMetadata(USER_ID, { displayName: "ada" }))) as AuthProviderError;
    expect(error).toBeInstanceOf(AuthProviderError);
    expect(error.code).toBe("unavailable");
    expect(error.message).not.toMatch(/ada|6aa5|not found/i);
  });

  test("without the service role key it is unavailable", async () => {
    const provider = createSupabaseAuthProvider({
      url: "https://example.supabase.co",
      anonKey: "anon",
      cookies: { getAll: () => [], setAll: () => {} },
    }, makeClient());
    await expect(provider.resetUserMetadata(USER_ID, { displayName: "ada" })).rejects.toMatchObject({ code: "unavailable" });
  });
});

describe("scramblePassword", () => {
  test("sets a strong random password through the admin client and returns nothing", async () => {
    const { provider, admin, client } = make();
    await expect(provider.scramblePassword(USER_ID)).resolves.toBeUndefined();
    expect(admin.auth.admin.updateUserById).toHaveBeenCalledTimes(1);
    const [userId, attributes] = admin.auth.admin.updateUserById.mock.calls[0] as [string, { password: string }];
    expect(userId).toBe(USER_ID);
    expect(Object.keys(attributes)).toEqual(["password"]);
    // At least 32 random base64url characters (192 bits or more), plus a fixed suffix so any
    // password policy (letters, digits, symbols) accepts it.
    expect(attributes.password.length).toBeGreaterThanOrEqual(32);
    expect(attributes.password).toMatch(/^[A-Za-z0-9_-]{32,}!aA1$/);
    expect(attributes.password).toMatch(/[a-z]/);
    expect(attributes.password).toMatch(/[A-Z]/);
    expect(attributes.password).toMatch(/[0-9]/);
    expect(attributes.password).toMatch(/[^A-Za-z0-9]/);
    // The user's own session client is not used.
    expect(client.auth.updateUser).not.toHaveBeenCalled();
  });

  test("uses a new value every time", async () => {
    const { provider, admin } = make();
    await provider.scramblePassword(USER_ID);
    await provider.scramblePassword(USER_ID);
    const [a, b] = admin.auth.admin.updateUserById.mock.calls.map((c) => (c[1] as { password: string }).password);
    expect(a).not.toBe(b);
  });

  test("never logs the value or puts it in an error", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    let password = "";
    const leaky = vi.fn(async (_id: string, attrs: { password: string }) => {
      password = attrs.password;
      return { data: { user: null }, error: new AuthApiError(`rejected ${attrs.password}`, 500, "unexpected_failure") };
    });
    const { provider } = make(makeClient(), makeAdmin(leaky));
    const error = (await caught(provider.scramblePassword(USER_ID))) as AuthProviderError;
    expect(error.code).toBe("unavailable");
    expect(password.length).toBeGreaterThanOrEqual(32);
    const texts = [error.message, String(error.stack), ...spies.flatMap((s) => s.mock.calls.flat().map(String))];
    for (const text of texts) expect(text).not.toContain(password);
  });

  test("errors map as elsewhere: rate limit, outage, a throwing client", async () => {
    expect(((await caught(make(makeClient(), makeAdmin(fails(rateLimited))).provider.scramblePassword(USER_ID))) as AuthProviderError).code).toBe(
      "rate_limited",
    );
    expect(((await caught(make(makeClient(), makeAdmin(fails(network))).provider.scramblePassword(USER_ID))) as AuthProviderError).code).toBe(
      "unavailable",
    );
    const throwing = makeAdmin(async () => {
      throw new TypeError("fetch failed");
    });
    expect(((await caught(make(makeClient(), throwing).provider.scramblePassword(USER_ID))) as AuthProviderError).code).toBe("unavailable");
  });

  test("without a service role key it is unavailable", async () => {
    const provider = createSupabaseAuthProvider(
      { url: "https://example.supabase.co", anonKey: "anon", cookies: { getAll: () => [], setAll: () => {} } },
      makeClient(),
    );
    const error = (await caught(provider.scramblePassword(USER_ID))) as AuthProviderError;
    expect(error).toBeInstanceOf(AuthProviderError);
    expect(error.code).toBe("unavailable");
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
      providerName: null,
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
      providerName: "Ada Lovelace",
    });
  });

  test("keeps the provider's (Google) name apart from the typed display name", async () => {
    const { provider } = make(makeClient({ getClaims: claims({ display_name: "Typed", full_name: "Ada Lovelace", name: "Ada" }) }));
    expect(await provider.getUser()).toMatchObject({ displayName: "Typed", providerName: "Ada Lovelace" });
    const { provider: short } = make(makeClient({ getClaims: claims({ display_name: "Typed", name: " Ada " }) }));
    expect(await short.getUser()).toMatchObject({ providerName: "Ada" });
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
  test('startGoogleSignIn passes provider "google", the redirectTo and prompt=select_account, and returns the URL', async () => {
    const { provider, client } = make();
    expect(await provider.startGoogleSignIn({ redirectTo: REDIRECT })).toEqual({
      url: "https://accounts.example/authorize",
    });
    expect(client.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: REDIRECT, skipBrowserRedirect: true, queryParams: { prompt: "select_account" } },
    });
  });

  test("completeOAuth exchanges the code and reports success", async () => {
    const { provider, client } = make();
    expect(await provider.completeOAuth("code-1")).toBe(true);
    expect(client.auth.exchangeCodeForSession).toHaveBeenCalledWith("code-1");
    const bad = make(makeClient({ exchangeCodeForSession: fails(new AuthApiError("invalid flow state", 404, "flow_state_not_found")) }));
    expect(await bad.provider.completeOAuth("code-1")).toBe(false);
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

  test("clearTermsAcceptance empties terms_version, terms_accepted_at and age_confirmed_at in user metadata", async () => {
    const { provider, client } = make();
    await provider.clearTermsAcceptance();
    expect(client.auth.updateUser).toHaveBeenCalledWith({
      data: { terms_version: null, terms_accepted_at: null, age_confirmed_at: null },
    });
    expect(client.auth.refreshSession).toHaveBeenCalledTimes(1);
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
