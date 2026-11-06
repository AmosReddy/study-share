import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeAuthProvider, createFakeAuthStore } from "@/server/adapters/fake-auth-provider";
import { createMemoryRateLimiter } from "@/server/adapters/memory-rate-limiter";
import { AuthProviderError } from "@/server/ports/auth-provider";
import type { RateLimiter } from "@/server/ports/rate-limiter";
import { TERMS_VERSION } from "@/shared/legal";
import {
  acceptTerms,
  logIn,
  requestPasswordReset,
  resendConfirmation,
  resetPassword,
  signUp,
  startGoogle,
  updateProfile,
  type Deps,
} from "./use-cases";

const SITE = "https://app.test";

function setup(overrides: Partial<Deps> = {}) {
  const jar = new Map<string, string>();
  const auth = createFakeAuthProvider({
    store: createFakeAuthStore(),
    cookies: {
      get: (name) => jar.get(name),
      set: (name, value) => void jar.set(name, value),
      delete: (name) => void jar.delete(name),
    },
  });
  const deps: Deps = { auth, limiter: createMemoryRateLimiter(), siteUrl: SITE, ip: "10.0.0.1", ...overrides };
  return { auth, deps };
}

/** Creates a confirmed account directly through the provider, then signs out. */
async function registerConfirmed(auth: ReturnType<typeof setup>["auth"], email: string, password: string) {
  await auth.signUpWithPassword({ email, password, displayName: "Test Person", termsVersion: TERMS_VERSION, redirectTo: SITE });
  const url = new URL(auth.outbox.lastFor(email)!.url, SITE);
  await auth.confirmEmailToken({ tokenHash: url.searchParams.get("token_hash")!, type: "email" });
  await auth.signOut();
}

const validSignUp = (email = "new@x.com") => ({
  displayName: "Asha Rao",
  email,
  password: "correct horse",
  acceptTerms: true,
});

describe("signUp", () => {
  it("returns field errors keyed by field and calls nothing when input is invalid", async () => {
    const { auth, deps } = setup();
    const spy = vi.spyOn(auth, "signUpWithPassword");
    const hit = vi.spyOn(deps.limiter, "hit");
    const result = await signUp(deps, { displayName: "A", email: "nope", password: "short", acceptTerms: false }, "/");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.fieldErrors ?? {}).sort()).toEqual(["acceptTerms", "displayName", "email", "password"]);
    expect(spy).not.toHaveBeenCalled();
    expect(hit).not.toHaveBeenCalled();
  });

  it("treats a non-object body as a form error", async () => {
    const { deps } = setup();
    const result = await signUp(deps, null, "/");
    expect(result.ok).toBe(false);
    expect(!result.ok && result.formError).toBeTruthy();
  });

  it("calls the provider once with an absolute redirectTo and the terms version", async () => {
    const { auth, deps } = setup();
    const spy = vi.spyOn(auth, "signUpWithPassword");
    const result = await signUp(deps, validSignUp(" New@X.com "), "/invite/abc?x=1");
    expect(result).toEqual({ ok: true, data: { status: "check_email" } });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({
      email: "new@x.com",
      password: "correct horse",
      displayName: "Asha Rao",
      termsVersion: TERMS_VERSION,
      redirectTo: `${SITE}/invite/abc?x=1`,
    });
  });

  it("replaces an unsafe next with /", async () => {
    const { auth, deps } = setup();
    const spy = vi.spyOn(auth, "signUpWithPassword");
    await signUp(deps, validSignUp(), "//evil.com");
    expect(spy.mock.calls[0][0].redirectTo).toBe(`${SITE}/`);
  });

  it("returns the same result for an existing email as for a new one", async () => {
    const { auth, deps } = setup();
    await registerConfirmed(auth, "taken@x.com", "first password");
    const existing = await signUp(deps, validSignUp("taken@x.com"), "/");
    const fresh = await signUp(deps, validSignUp("fresh@x.com"), "/");
    expect(existing).toEqual(fresh);
    expect(existing).toEqual({ ok: true, data: { status: "check_email" } });
  });

  it("refuses the 6th attempt for one email in an hour without calling the provider", async () => {
    const { auth, deps } = setup();
    const spy = vi.spyOn(auth, "signUpWithPassword");
    for (let i = 0; i < 5; i++) expect((await signUp(deps, validSignUp(), "/")).ok).toBe(true);
    const sixth = await signUp(deps, validSignUp(), "/");
    expect(sixth.ok).toBe(false);
    if (sixth.ok) return;
    expect(sixth.retryAfterSeconds).toBeGreaterThan(0);
    expect(sixth.formError).toMatch(/too many/i);
    expect(spy).toHaveBeenCalledTimes(5);
  });

  it("shares one limit between upper and lower case emails", async () => {
    const { deps } = setup();
    const variants = ["A@x.com", "a@x.com", " A@X.COM ", "a@X.com", "A@x.com"];
    for (const email of variants) expect((await signUp(deps, validSignUp(email), "/")).ok).toBe(true);
    expect((await signUp(deps, validSignUp("a@x.com"), "/")).ok).toBe(false);
  });

  it("refuses the 31st attempt from one IP while another IP is still allowed", async () => {
    const limiter = createMemoryRateLimiter();
    const { auth } = setup();
    const a: Deps = { auth, limiter, siteUrl: SITE, ip: "1.1.1.1" };
    const b: Deps = { ...a, ip: "2.2.2.2" };
    for (let i = 0; i < 30; i++) expect((await signUp(a, validSignUp(`u${i}@x.com`), "/")).ok).toBe(true);
    const refused = await signUp(a, validSignUp("u31@x.com"), "/");
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.retryAfterSeconds).toBeGreaterThan(0);
    expect((await signUp(b, validSignUp("u31@x.com"), "/")).ok).toBe(true);
  });

  it("uses namespaced keys", async () => {
    const hit = vi.fn<RateLimiter["hit"]>(async () => ({ allowed: true, retryAfterSeconds: 0 }));
    const { deps } = setup({ limiter: { hit } });
    await signUp(deps, validSignUp("k@x.com"), "/");
    expect(hit.mock.calls.map((c) => c[0].key)).toEqual(["signup:email:k@x.com", "signup:ip:10.0.0.1"]);
  });
});

describe("provider errors become plain messages", () => {
  const secret = "vendor-secret-token-abc123";
  type R = Awaited<ReturnType<typeof signUp>>;

  it.each([
    ["unavailable", (r: R) => !r.ok && /something went wrong/i.test(r.formError ?? "")],
    ["weak_password", (r: R) => !r.ok && Boolean(r.fieldErrors?.password)],
  ] as const)("%s on sign-up", async (code, check) => {
    const { auth, deps } = setup();
    vi.spyOn(auth, "signUpWithPassword").mockRejectedValue(new AuthProviderError(code, secret));
    const result = await signUp(deps, validSignUp(), "/");
    expect(check(result)).toBe(true);
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("never leaks vendor text from log-in, reset request or Google", async () => {
    const { auth, deps } = setup();
    vi.spyOn(auth, "signInWithPassword").mockRejectedValue(new AuthProviderError("rate_limited", secret));
    vi.spyOn(auth, "sendPasswordReset").mockRejectedValue(new AuthProviderError("unavailable", secret));
    vi.spyOn(auth, "startGoogleSignIn").mockRejectedValue(new AuthProviderError("unavailable", secret));
    const results = [
      await logIn(deps, { email: "a@x.com", password: "pw" }, "/"),
      await requestPasswordReset(deps, { email: "a@x.com" }),
      await startGoogle(deps, "/"),
    ];
    for (const r of results) {
      expect(r.ok).toBe(false);
      expect(JSON.stringify(r)).not.toContain(secret);
    }
  });
});

describe("logIn", () => {
  it("signs in and returns the safe next path", async () => {
    const { auth, deps } = setup();
    await registerConfirmed(auth, "me@x.com", "my password");
    const result = await logIn(deps, { email: "Me@X.com", password: "my password" }, "/groups/1?tab=a");
    expect(result).toEqual({ ok: true, data: { redirectTo: "/groups/1?tab=a" } });
    expect(await auth.getUser()).not.toBeNull();
  });

  it("turns a bad next into /", async () => {
    const { auth, deps } = setup();
    await registerConfirmed(auth, "me@x.com", "my password");
    const result = await logIn(deps, { email: "me@x.com", password: "my password" }, "//evil.com");
    expect(result).toEqual({ ok: true, data: { redirectTo: "/" } });
  });

  it("returns one generic error for unknown and known emails", async () => {
    const { auth, deps } = setup();
    await registerConfirmed(auth, "known@x.com", "right password");
    const known = await logIn(deps, { email: "known@x.com", password: "wrong password" }, "/");
    const unknown = await logIn(deps, { email: "ghost@x.com", password: "wrong password" }, "/");
    expect(known).toEqual(unknown);
    expect(known.ok).toBe(false);
    if (known.ok) return;
    expect(known.formError).toBeTruthy();
    expect(known.formError).not.toBe("confirm_email");
    expect(known.formError).not.toContain("known@x.com");
  });

  it('returns formError "confirm_email" when the email is not confirmed', async () => {
    const { auth, deps } = setup();
    await auth.signUpWithPassword({
      email: "pending@x.com",
      password: "right password",
      displayName: "Pending",
      termsVersion: TERMS_VERSION,
      redirectTo: SITE,
    });
    const result = await logIn(deps, { email: "pending@x.com", password: "right password" }, "/");
    expect(result).toEqual({ ok: false, formError: "confirm_email" });
  });

  it("returns field errors for an empty password and does not call the provider", async () => {
    const { auth, deps } = setup();
    const spy = vi.spyOn(auth, "signInWithPassword");
    const result = await logIn(deps, { email: "a@x.com", password: "" }, "/");
    expect(!result.ok && result.fieldErrors?.password).toBeTruthy();
    expect(spy).not.toHaveBeenCalled();
  });

  it("refuses the 11th attempt for an email in 15 minutes", async () => {
    const { auth, deps } = setup();
    const spy = vi.spyOn(auth, "signInWithPassword");
    for (let i = 0; i < 10; i++) {
      const r = await logIn(deps, { email: "victim@x.com", password: `guess ${i}` }, "/");
      expect(r.ok).toBe(false);
    }
    const eleventh = await logIn(deps, { email: "VICTIM@x.com", password: "guess 11" }, "/");
    expect(eleventh.ok).toBe(false);
    if (eleventh.ok) return;
    expect(eleventh.retryAfterSeconds).toBeGreaterThan(0);
    expect(spy).toHaveBeenCalledTimes(10);
  });

  it("refuses the 101st attempt from one IP in an hour", async () => {
    const { deps } = setup();
    for (let i = 0; i < 100; i++) await logIn(deps, { email: `u${i}@x.com`, password: "pw" }, "/");
    const result = await logIn(deps, { email: "u101@x.com", password: "pw" }, "/");
    expect(!result.ok && result.retryAfterSeconds).toBeGreaterThan(0);
  });
});

describe("resendConfirmation", () => {
  it("sends with the sign-up redirect and is limited to 3 per email per hour", async () => {
    const { auth, deps } = setup();
    const spy = vi.spyOn(auth, "resendConfirmation");
    for (let i = 0; i < 3; i++) {
      expect(await resendConfirmation(deps, { email: "Pending@x.com" }, "/invite/z")).toEqual({ ok: true, data: undefined });
    }
    expect(spy).toHaveBeenCalledWith({ email: "pending@x.com", redirectTo: `${SITE}/invite/z` });
    const fourth = await resendConfirmation(deps, { email: "pending@x.com" }, "/invite/z");
    expect(!fourth.ok && fourth.retryAfterSeconds).toBeGreaterThan(0);
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it("rejects an invalid email without calling anything", async () => {
    const { auth, deps } = setup();
    const spy = vi.spyOn(auth, "resendConfirmation");
    const result = await resendConfirmation(deps, { email: "nope" }, "/");
    expect(!result.ok && result.fieldErrors?.email).toBeTruthy();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("requestPasswordReset", () => {
  it("returns check_email for an unknown email and sends nothing", async () => {
    const { auth, deps } = setup();
    const result = await requestPasswordReset(deps, { email: "ghost@x.com" });
    expect(result).toEqual({ ok: true, data: { status: "check_email" } });
    expect(auth.outbox.entries).toHaveLength(0);
  });

  it("returns the same result for a known email and uses the reset-password redirect", async () => {
    const { auth, deps } = setup();
    await registerConfirmed(auth, "me@x.com", "my password");
    const spy = vi.spyOn(auth, "sendPasswordReset");
    const result = await requestPasswordReset(deps, { email: "ME@x.com" });
    expect(result).toEqual({ ok: true, data: { status: "check_email" } });
    expect(spy).toHaveBeenCalledWith({ email: "me@x.com", redirectTo: `${SITE}/reset-password` });
  });

  it("refuses the 4th request for an email in an hour", async () => {
    const { auth, deps } = setup();
    const spy = vi.spyOn(auth, "sendPasswordReset");
    for (let i = 0; i < 3; i++) expect((await requestPasswordReset(deps, { email: "a@x.com" })).ok).toBe(true);
    const fourth = await requestPasswordReset(deps, { email: "A@x.com" });
    expect(!fourth.ok && fourth.retryAfterSeconds).toBeGreaterThan(0);
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it("refuses the 31st request from one IP", async () => {
    const { deps } = setup();
    for (let i = 0; i < 30; i++) await requestPasswordReset(deps, { email: `u${i}@x.com` });
    expect((await requestPasswordReset(deps, { email: "u31@x.com" })).ok).toBe(false);
  });
});

describe("resetPassword", () => {
  async function signedIn() {
    const ctx = setup();
    await registerConfirmed(ctx.auth, "me@x.com", "old password");
    await ctx.auth.signInWithPassword({ email: "me@x.com", password: "old password" });
    return ctx;
  }

  it("needs a matching confirm password", async () => {
    const { auth, deps } = await signedIn();
    const spy = vi.spyOn(auth, "updatePassword");
    const result = await resetPassword(deps, { password: "new password 1", confirmPassword: "different" });
    expect(!result.ok && result.fieldErrors?.confirmPassword).toBeTruthy();
    expect(spy).not.toHaveBeenCalled();
  });

  it("needs at least 8 characters", async () => {
    const { auth, deps } = await signedIn();
    const spy = vi.spyOn(auth, "updatePassword");
    const result = await resetPassword(deps, { password: "short", confirmPassword: "short" });
    expect(!result.ok && result.fieldErrors?.password).toBeTruthy();
    expect(spy).not.toHaveBeenCalled();
  });

  it("updates the password when valid", async () => {
    const { auth, deps } = await signedIn();
    const result = await resetPassword(deps, { password: "new password 1", confirmPassword: "new password 1" });
    expect(result).toEqual({ ok: true, data: undefined });
    await auth.signOut();
    expect(await auth.signInWithPassword({ email: "me@x.com", password: "new password 1" })).toEqual({ ok: true });
  });

  it("asks the person to start again when there is no session", async () => {
    const { deps } = setup();
    const result = await resetPassword(deps, { password: "new password 1", confirmPassword: "new password 1" });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.formError).toBeTruthy();
  });

  it("maps weak_password from the provider to a password field error", async () => {
    const { auth, deps } = await signedIn();
    vi.spyOn(auth, "updatePassword").mockRejectedValue(new AuthProviderError("weak_password", "vendor text"));
    const result = await resetPassword(deps, { password: "new password 1", confirmPassword: "new password 1" });
    expect(!result.ok && result.fieldErrors?.password).toBeTruthy();
    expect(JSON.stringify(result)).not.toContain("vendor text");
  });

  it("allows 10 updates per user per hour and refuses the 11th", async () => {
    const { auth, deps } = await signedIn();
    const spy = vi.spyOn(auth, "updatePassword");
    for (let i = 0; i < 10; i++) {
      const pw = `new password ${i}`;
      expect((await resetPassword(deps, { password: pw, confirmPassword: pw })).ok).toBe(true);
    }
    const eleventh = await resetPassword(deps, { password: "new password x", confirmPassword: "new password x" });
    expect(!eleventh.ok && eleventh.retryAfterSeconds).toBeGreaterThan(0);
    expect(spy).toHaveBeenCalledTimes(10);
  });
});

describe("startGoogle", () => {
  it("passes an absolute redirect built from the safe next path", async () => {
    const { auth, deps } = setup();
    const spy = vi.spyOn(auth, "startGoogleSignIn");
    const result = await startGoogle(deps, "/invite/q");
    expect(result.ok).toBe(true);
    expect(result.ok && typeof result.data.url).toBe("string");
    expect(spy).toHaveBeenCalledWith({ redirectTo: `${SITE}/invite/q` });
    await startGoogle(deps, "https://evil.com");
    expect(spy).toHaveBeenLastCalledWith({ redirectTo: `${SITE}/` });
  });
});

describe("acceptTerms", () => {
  async function signedIn() {
    const ctx = setup();
    await registerConfirmed(ctx.auth, "me@x.com", "my password");
    await ctx.auth.signInWithPassword({ email: "me@x.com", password: "my password" });
    return ctx;
  }

  it("requires the checkbox", async () => {
    const { auth, deps } = await signedIn();
    const spy = vi.spyOn(auth, "acceptTerms");
    const result = await acceptTerms(deps, { acceptTerms: false, termsVersion: TERMS_VERSION }, "/");
    expect(!result.ok && result.fieldErrors?.acceptTerms).toBeTruthy();
    expect(spy).not.toHaveBeenCalled();
  });

  it("records TERMS_VERSION and returns the safe next path", async () => {
    const { auth, deps } = await signedIn();
    const spy = vi.spyOn(auth, "acceptTerms");
    const result = await acceptTerms(deps, { acceptTerms: true, termsVersion: TERMS_VERSION }, "/groups/9");
    expect(result).toEqual({ ok: true, data: { redirectTo: "/groups/9" } });
    expect(spy).toHaveBeenCalledWith({ termsVersion: TERMS_VERSION });
    expect((await auth.getUser())?.termsVersion).toBe(TERMS_VERSION);
  });

  it.each([["an older version", "1999-01-01"], ["a missing version", undefined]])(
    "refuses %s of the terms and does not record anything",
    async (_label, termsVersion) => {
      const { auth, deps } = await signedIn();
      const spy = vi.spyOn(auth, "acceptTerms");
      const result = await acceptTerms(deps, { acceptTerms: true, termsVersion }, "/groups/9");
      expect(result.ok).toBe(false);
      expect(!result.ok && result.formError).toMatch(/terms/i);
      expect(spy).not.toHaveBeenCalled();
    },
  );

  it("falls back to / for an unsafe next", async () => {
    const { deps } = await signedIn();
    const result = await acceptTerms(deps, { acceptTerms: true, termsVersion: TERMS_VERSION }, "//evil.com");
    expect(result).toEqual({ ok: true, data: { redirectTo: "/" } });
  });
});

describe("updateProfile", () => {
  it("validates the display name", async () => {
    const { auth, deps } = setup();
    const spy = vi.spyOn(auth, "updateDisplayName");
    const result = await updateProfile(deps, { displayName: "A" });
    expect(!result.ok && result.fieldErrors?.displayName).toBeTruthy();
    expect(spy).not.toHaveBeenCalled();
  });

  it("saves a trimmed display name", async () => {
    const { auth, deps } = setup();
    await registerConfirmed(auth, "me@x.com", "my password");
    await auth.signInWithPassword({ email: "me@x.com", password: "my password" });
    const result = await updateProfile(deps, { displayName: "  New Name  " });
    expect(result).toEqual({ ok: true, data: undefined });
    expect((await auth.getUser())?.displayName).toBe("New Name");
  });
});

describe("a rate limit store that fails", () => {
  const failing: RateLimiter = {
    hit: async () => {
      throw new Error("connection to postgres://user:pw@db failed for signup:email:a@x.com from 10.0.0.1");
    },
  };
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  function expectOneCleanWarning() {
    expect(warn).toHaveBeenCalledTimes(1);
    const text = JSON.stringify(warn.mock.calls[0]);
    for (const leak of ["a@x.com", "10.0.0.1", "signup:", "login:", "postgres://", "pw@"]) {
      expect(text).not.toContain(leak);
    }
  }

  it("does not stop sign-up and logs one warning", async () => {
    const { auth, deps } = setup({ limiter: failing });
    const spy = vi.spyOn(auth, "signUpWithPassword");
    const result = await signUp(deps, validSignUp("a@x.com"), "/");
    expect(result).toEqual({ ok: true, data: { status: "check_email" } });
    expect(spy).toHaveBeenCalledTimes(1);
    expectOneCleanWarning();
  });

  it("does not stop log-in and logs one warning", async () => {
    const { auth, deps } = setup({ limiter: failing });
    await registerConfirmed(auth, "a@x.com", "my password");
    const result = await logIn(deps, { email: "a@x.com", password: "my password" }, "/");
    expect(result).toEqual({ ok: true, data: { redirectTo: "/" } });
    expectOneCleanWarning();
  });
});

describe("provider rate limits do not reveal which emails have accounts", () => {
  /** Mimics Supabase: one email per known address per minute, so a quick repeat is refused for known addresses only. */
  function limitKnownEmails(auth: ReturnType<typeof setup>["auth"], method: "sendPasswordReset" | "resendConfirmation" | "signUpWithPassword") {
    const real = auth[method].bind(auth) as (i: { email: string }) => Promise<void>;
    const known = new Set<string>();
    const sent = new Set<string>();
    vi.spyOn(auth, method).mockImplementation((async (i: { email: string }) => {
      if (known.has(i.email) && sent.has(i.email)) throw new AuthProviderError("rate_limited", "over_email_send_rate_limit");
      sent.add(i.email);
      return real(i);
    }) as never);
    return known;
  }

  it("requestPasswordReset returns the same result for a known and an unknown email on a quick repeat", async () => {
    const { auth, deps } = setup();
    limitKnownEmails(auth, "sendPasswordReset").add("known@x.com");
    const results: Record<string, unknown[]> = { "known@x.com": [], "ghost@x.com": [] };
    for (const email of Object.keys(results)) {
      for (let i = 0; i < 2; i++) results[email].push(await requestPasswordReset(deps, { email }));
    }
    expect(results["known@x.com"]).toEqual(results["ghost@x.com"]);
    expect(results["known@x.com"][1]).toEqual({ ok: true, data: { status: "check_email" } });
  });

  it("resendConfirmation returns the same result for a known and an unknown email on a quick repeat", async () => {
    const { auth, deps } = setup();
    limitKnownEmails(auth, "resendConfirmation").add("known@x.com");
    const second: unknown[] = [];
    for (const email of ["known@x.com", "ghost@x.com"]) {
      await resendConfirmation(deps, { email }, "/");
      second.push(await resendConfirmation(deps, { email }, "/"));
    }
    expect(second[0]).toEqual(second[1]);
    expect(second[0]).toEqual({ ok: true, data: undefined });
  });

  it("signUp returns check_email when the provider refuses a repeat for an existing address", async () => {
    const { auth, deps } = setup();
    limitKnownEmails(auth, "signUpWithPassword").add("known@x.com");
    await signUp(deps, validSignUp("known@x.com"), "/");
    const repeat = await signUp(deps, validSignUp("known@x.com"), "/");
    const fresh = await signUp(deps, validSignUp("fresh@x.com"), "/");
    expect(repeat).toEqual(fresh);
    expect(repeat).toEqual({ ok: true, data: { status: "check_email" } });
  });

  it("logs nothing that identifies the email or the provider text", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { auth, deps } = setup();
      vi.spyOn(auth, "sendPasswordReset").mockRejectedValue(new AuthProviderError("rate_limited", "over_email_send_rate_limit"));
      await requestPasswordReset(deps, { email: "known@x.com" });
      const text = JSON.stringify(warn.mock.calls);
      for (const leak of ["known@x.com", "over_email_send_rate_limit", "10.0.0.1"]) expect(text).not.toContain(leak);
    } finally {
      warn.mockRestore();
    }
  });

  it("logIn still reports too many attempts", async () => {
    const { auth, deps } = setup();
    vi.spyOn(auth, "signInWithPassword").mockRejectedValue(new AuthProviderError("rate_limited"));
    const result = await logIn(deps, { email: "a@x.com", password: "pw" }, "/");
    expect(!result.ok && result.formError).toMatch(/too many/i);
  });
});

describe("the client address", () => {
  const keysFor = async (ip: string, run: (deps: Deps) => Promise<unknown>) => {
    const hit = vi.fn<RateLimiter["hit"]>(async () => ({ allowed: true, retryAfterSeconds: 0 }));
    const { deps } = setup({ limiter: { hit }, ip });
    await run(deps);
    return hit.mock.calls.map((c) => c[0].key);
  };

  it.each(["", "   "])("skips the per-IP limit when the address is unknown (%j)", async (ip) => {
    expect(await keysFor(ip, (d) => signUp(d, validSignUp("k@x.com"), "/"))).toEqual(["signup:email:k@x.com"]);
    expect(await keysFor(ip, (d) => logIn(d, { email: "k@x.com", password: "pw" }, "/"))).toEqual(["login:email:k@x.com"]);
    expect(await keysFor(ip, (d) => requestPasswordReset(d, { email: "k@x.com" }))).toEqual(["reset:email:k@x.com"]);
  });

  it("does not put everyone without an address into one bucket", async () => {
    const { deps } = setup({ ip: "" });
    for (let i = 0; i < 31; i++) expect((await signUp(deps, validSignUp(`u${i}@x.com`), "/")).ok).toBe(true);
  });

  it("trims the address and caps its length at 64 characters in the key", async () => {
    const long = "a".repeat(200);
    const [, ipKey] = await keysFor(`  ${long}  `, (d) => signUp(d, validSignUp("k@x.com"), "/"));
    expect(ipKey).toBe(`signup:ip:${"a".repeat(64)}`);
    const [, loginIp] = await keysFor("1.2.3.4 ", (d) => logIn(d, { email: "k@x.com", password: "pw" }, "/"));
    expect(loginIp).toBe("login:ip:1.2.3.4");
  });
});
