import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeAccountDirectory } from "@/server/adapters/fake-account-directory";
import { createFakeAuthProvider, createFakeAuthStore, expireAllCodes, type FakeAuthStore } from "@/server/adapters/fake-auth-provider";
import { createMemoryRateLimiter } from "@/server/adapters/memory-rate-limiter";
import { AuthProviderError } from "@/server/ports/auth-provider";
import type { RateLimiter } from "@/server/ports/rate-limiter";
import { AUTH_MESSAGES } from "@/shared/auth-messages";
import { TERMS_VERSION } from "@/shared/legal";
import {
  acceptTerms,
  logIn,
  logOut,
  repairGoogleAccount,
  requestPasswordReset,
  requestPasswordResetLink,
  resendConfirmation,
  resendSignUpCode,
  resetPassword,
  setPassword,
  signUp,
  signUpWithLink,
  startGoogle,
  updateProfile,
  verifyResetCode,
  verifySignUpCode,
  PASSWORD_NOT_REPLACED_WARNING,
  type Deps,
} from "./use-cases";

const SITE = "https://app.test";

/** A fake provider with its own cookie jar (one browser) over a shared store. */
function browser(store: FakeAuthStore) {
  const jar = new Map<string, string>();
  return createFakeAuthProvider({
    store,
    cookies: {
      get: (name) => jar.get(name),
      set: (name, value) => void jar.set(name, value),
      delete: (name) => void jar.delete(name),
    },
  });
}

/** The limiter runs on a test clock: `advance(seconds)` moves it on. */
function setup(overrides: Partial<Deps> = {}, store: FakeAuthStore = createFakeAuthStore()) {
  const auth = browser(store);
  let now = 1_000_000;
  const limiter = createMemoryRateLimiter(() => now);
  const directory = createFakeAccountDirectory(store);
  const deps: Deps = { auth, limiter, siteUrl: SITE, ip: "10.0.0.1", directory, pending: null, ...overrides };
  const advance = (seconds: number) => void (now += seconds * 1000);
  return { auth, deps, advance, store, directory };
}

/** A limiter answer that allows: for stub limiters that only record hits. */
const allowPeek = async () => ({ allowed: true, retryAfterSeconds: 0 });

/** Just past the shared one-email-a-minute cooldown. */
const PAST_COOLDOWN = 61;
const COOLDOWN_MESSAGE = "We just sent you an email. Please wait a minute before trying again.";
const COULD_NOT_SEND = "We couldn't send the email right now. Please try again in a few minutes.";

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

describe("signUpWithLink (deprecated link flow, Task 5 deletes it)", () => {
  it("returns field errors keyed by field and calls nothing when input is invalid", async () => {
    const { auth, deps } = setup();
    const spy = vi.spyOn(auth, "signUpWithPassword");
    const hit = vi.spyOn(deps.limiter, "hit");
    const result = await signUpWithLink(deps, { displayName: "A", email: "nope", password: "short", acceptTerms: false }, "/");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.fieldErrors ?? {}).sort()).toEqual(["acceptTerms", "displayName", "email", "password"]);
    expect(spy).not.toHaveBeenCalled();
    expect(hit).not.toHaveBeenCalled();
  });

  it("treats a non-object body as a form error", async () => {
    const { deps } = setup();
    const result = await signUpWithLink(deps, null, "/");
    expect(result.ok).toBe(false);
    expect(!result.ok && result.formError).toBeTruthy();
  });

  it("calls the provider once with an absolute redirectTo and the terms version", async () => {
    const { auth, deps } = setup();
    const spy = vi.spyOn(auth, "signUpWithPassword");
    const result = await signUpWithLink(deps, validSignUp(" New@X.com "), "/invite/abc?x=1");
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
    await signUpWithLink(deps, validSignUp(), "//evil.com");
    expect(spy.mock.calls[0][0].redirectTo).toBe(`${SITE}/`);
  });

  it("returns the same result for an existing email as for a new one", async () => {
    const { auth, deps } = setup();
    await registerConfirmed(auth, "taken@x.com", "first password");
    const existing = await signUpWithLink(deps, validSignUp("taken@x.com"), "/");
    const fresh = await signUpWithLink(deps, validSignUp("fresh@x.com"), "/");
    expect(existing).toEqual(fresh);
    expect(existing).toEqual({ ok: true, data: { status: "check_email" } });
  });

  // Attempts are spaced past the one-email-a-minute cooldown, so only the hourly limit decides.
  it("refuses the 6th attempt for one email in an hour without calling the provider", async () => {
    const { auth, deps, advance } = setup();
    const spy = vi.spyOn(auth, "signUpWithPassword");
    for (let i = 0; i < 5; i++) {
      expect((await signUpWithLink(deps, validSignUp(), "/")).ok).toBe(true);
      advance(PAST_COOLDOWN);
    }
    const sixth = await signUpWithLink(deps, validSignUp(), "/");
    expect(sixth.ok).toBe(false);
    if (sixth.ok) return;
    expect(sixth.retryAfterSeconds).toBeGreaterThan(0);
    expect(sixth.formError).toMatch(/too many/i);
    expect(spy).toHaveBeenCalledTimes(5);
  });

  it("shares one limit between upper and lower case emails", async () => {
    const { deps, advance } = setup();
    const variants = ["A@x.com", "a@x.com", " A@X.COM ", "a@X.com", "A@x.com"];
    for (const email of variants) {
      expect((await signUpWithLink(deps, validSignUp(email), "/")).ok).toBe(true);
      advance(PAST_COOLDOWN);
    }
    expect((await signUpWithLink(deps, validSignUp("a@x.com"), "/")).ok).toBe(false);
  });

  it("refuses the 31st attempt from one IP while another IP is still allowed", async () => {
    const limiter = createMemoryRateLimiter();
    const { auth } = setup();
    const a: Deps = { ...setup().deps, auth, limiter, ip: "1.1.1.1" };
    const b: Deps = { ...a, ip: "2.2.2.2" };
    for (let i = 0; i < 30; i++) expect((await signUpWithLink(a, validSignUp(`u${i}@x.com`), "/")).ok).toBe(true);
    const refused = await signUpWithLink(a, validSignUp("u31@x.com"), "/");
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.retryAfterSeconds).toBeGreaterThan(0);
    // Another address: u31's one-a-minute cooldown was counted by the refused attempt above.
    expect((await signUpWithLink(b, validSignUp("u32@x.com"), "/")).ok).toBe(true);
  });

  it("uses namespaced keys", async () => {
    const hit = vi.fn<RateLimiter["hit"]>(async () => ({ allowed: true, retryAfterSeconds: 0 }));
    const { deps } = setup({ limiter: { hit, peek: allowPeek } });
    await signUpWithLink(deps, validSignUp("k@x.com"), "/");
    expect(hit.mock.calls.map((c) => c[0].key)).toEqual([
      "email-send:k@x.com",
      "signup:email:k@x.com",
      "signup:ip:10.0.0.1",
    ]);
  });
});

describe("one email a minute per address (shared by sign-up, resend and reset)", () => {
  const flows = {
    signUp: (deps: Deps, email: string) => signUpWithLink(deps, validSignUp(email), "/"),
    resend: (deps: Deps, email: string) => resendConfirmation(deps, { email }, "/"),
    reset: (deps: Deps, email: string) => requestPasswordResetLink(deps, { email }),
  } as const;

  it.each(Object.keys(flows) as (keyof typeof flows)[])(
    "%s: a second send within 60 seconds is refused without calling the provider, and passes after",
    async (flow) => {
      const { auth, deps, advance } = setup();
      const providerCalls = [
        vi.spyOn(auth, "signUpWithPassword"),
        vi.spyOn(auth, "resendConfirmation"),
        vi.spyOn(auth, "sendPasswordReset"),
      ];
      const calls = () => providerCalls.reduce((n, spy) => n + spy.mock.calls.length, 0);

      expect((await flows[flow](deps, "a@x.com")).ok).toBe(true);
      advance(59);
      const refused = await flows[flow](deps, "a@x.com");
      expect(refused).toEqual({ ok: false, formError: COOLDOWN_MESSAGE, retryAfterSeconds: 1 });
      expect(calls()).toBe(1);

      advance(1);
      expect((await flows[flow](deps, "a@x.com")).ok).toBe(true);
      expect(calls()).toBe(2);
    },
  );

  it("is shared across the three flows", async () => {
    const { deps, advance } = setup();
    expect((await flows.signUp(deps, "a@x.com")).ok).toBe(true);
    expect(await flows.resend(deps, "a@x.com")).toMatchObject({ ok: false, formError: COOLDOWN_MESSAGE });
    expect(await flows.reset(deps, "a@x.com")).toMatchObject({ ok: false, formError: COOLDOWN_MESSAGE });
    advance(PAST_COOLDOWN);
    expect((await flows.reset(deps, "a@x.com")).ok).toBe(true);
    expect(await flows.signUp(deps, "a@x.com")).toMatchObject({ ok: false, formError: COOLDOWN_MESSAGE });
  });

  it("is per normalised email: case and spaces do not matter, another address is not affected", async () => {
    const { deps } = setup();
    expect((await flows.reset(deps, "A@X.com")).ok).toBe(true);
    expect(await flows.resend(deps, "  a@x.COM ")).toMatchObject({ ok: false, formError: COOLDOWN_MESSAGE });
    expect((await flows.reset(deps, "b@x.com")).ok).toBe(true);
  });

  it("does not count a request that fails validation", async () => {
    const { deps } = setup();
    const invalid = await signUpWithLink(deps, { ...validSignUp("a@x.com"), password: "short" }, "/");
    expect(!invalid.ok && invalid.fieldErrors?.password).toBeTruthy();
    expect((await flows.signUp(deps, "a@x.com")).ok).toBe(true);
  });

  it("refuses known and unknown addresses alike (it depends only on our own counter)", async () => {
    const { auth, deps } = setup();
    await registerConfirmed(auth, "known@x.com", "my password");
    const results = [];
    for (const email of ["known@x.com", "ghost@x.com"]) {
      await flows.reset(deps, email);
      results.push(await flows.reset(deps, email));
    }
    expect(results[0]).toEqual(results[1]);
    expect(results[0]).toMatchObject({ ok: false, formError: COOLDOWN_MESSAGE });
  });
});

describe("provider errors become plain messages", () => {
  const secret = "vendor-secret-token-abc123";
  type R = Awaited<ReturnType<typeof signUpWithLink>>;

  it.each([
    ["unavailable", (r: R) => !r.ok && /something went wrong/i.test(r.formError ?? "")],
    ["weak_password", (r: R) => !r.ok && Boolean(r.fieldErrors?.password)],
  ] as const)("%s on sign-up", async (code, check) => {
    const { auth, deps } = setup();
    vi.spyOn(auth, "signUpWithPassword").mockRejectedValue(new AuthProviderError(code, secret));
    const result = await signUpWithLink(deps, validSignUp(), "/");
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
      await requestPasswordResetLink(deps, { email: "a@x.com" }),
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
    const { auth, deps, advance } = setup();
    const spy = vi.spyOn(auth, "resendConfirmation");
    for (let i = 0; i < 3; i++) {
      expect(await resendConfirmation(deps, { email: "Pending@x.com" }, "/invite/z")).toEqual({ ok: true, data: undefined });
      advance(PAST_COOLDOWN);
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

describe("requestPasswordResetLink (deprecated link flow, Task 5 deletes it)", () => {
  it("returns check_email for an unknown email and sends nothing", async () => {
    const { auth, deps } = setup();
    const result = await requestPasswordResetLink(deps, { email: "ghost@x.com" });
    expect(result).toEqual({ ok: true, data: { status: "check_email" } });
    expect(auth.outbox.entries).toHaveLength(0);
  });

  it("returns the same result for a known email and uses the reset-password redirect", async () => {
    const { auth, deps } = setup();
    await registerConfirmed(auth, "me@x.com", "my password");
    const spy = vi.spyOn(auth, "sendPasswordReset");
    const result = await requestPasswordResetLink(deps, { email: "ME@x.com" });
    expect(result).toEqual({ ok: true, data: { status: "check_email" } });
    expect(spy).toHaveBeenCalledWith({ email: "me@x.com", redirectTo: `${SITE}/reset-password` });
  });

  it("refuses the 4th request for an email in an hour", async () => {
    const { auth, deps, advance } = setup();
    const spy = vi.spyOn(auth, "sendPasswordReset");
    for (let i = 0; i < 3; i++) {
      expect((await requestPasswordResetLink(deps, { email: "a@x.com" })).ok).toBe(true);
      advance(PAST_COOLDOWN);
    }
    const fourth = await requestPasswordResetLink(deps, { email: "A@x.com" });
    expect(!fourth.ok && fourth.retryAfterSeconds).toBeGreaterThan(0);
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it("refuses the 31st request from one IP", async () => {
    const { deps } = setup();
    for (let i = 0; i < 30; i++) await requestPasswordResetLink(deps, { email: `u${i}@x.com` });
    expect((await requestPasswordResetLink(deps, { email: "u31@x.com" })).ok).toBe(false);
  });
});

describe("resetPassword", () => {
  /** Signed in by a recovery link: the provider refuses a password change from a password sign-in session. */
  async function signedIn() {
    const ctx = setup();
    await registerConfirmed(ctx.auth, "me@x.com", "old password");
    await ctx.auth.sendPasswordReset({ email: "me@x.com", redirectTo: `${SITE}/reset-password` });
    const url = new URL(ctx.auth.outbox.lastFor("me@x.com")!.url, SITE);
    await ctx.auth.confirmEmailToken({ tokenHash: url.searchParams.get("token_hash")!, type: "recovery" });
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

describe("a rate limit store that never answers", () => {
  const hanging: RateLimiter = { hit: () => new Promise(() => {}), peek: () => new Promise(() => {}) };
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
    vi.useRealTimers();
  });

  it("gives up after 2 seconds, allows sign-up and logs the same single warning", async () => {
    const { auth, deps } = setup({ limiter: hanging });
    const spy = vi.spyOn(auth, "signUpWithPassword");
    const pending = signUpWithLink(deps, validSignUp("a@x.com"), "/");
    await vi.advanceTimersByTimeAsync(1999);
    expect(spy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000 * 3);
    expect(await pending).toEqual({ ok: true, data: { status: "check_email" } });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBe("Rate limit store unavailable; allowing the request.");
  });

  it("does not stop log-in either", async () => {
    const { auth, deps } = setup({ limiter: hanging });
    await registerConfirmed(auth, "a@x.com", "my password");
    const pending = logIn(deps, { email: "a@x.com", password: "my password" }, "/");
    await vi.advanceTimersByTimeAsync(2000 * 2);
    expect(await pending).toEqual({ ok: true, data: { redirectTo: "/" } });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("a slow but working store still decides (no timeout under 2 seconds)", async () => {
    const real = createMemoryRateLimiter(() => 0);
    const slow: RateLimiter = {
      hit: (i) => new Promise((resolve) => setTimeout(() => resolve(real.hit(i)), 1500)),
      peek: (i) => new Promise((resolve) => setTimeout(() => resolve(real.peek(i)), 1500)),
    };
    const { deps } = setup({ limiter: slow });
    const first = signUpWithLink(deps, validSignUp("a@x.com"), "/");
    await vi.advanceTimersByTimeAsync(1500 * 3);
    expect((await first).ok).toBe(true);
    const second = signUpWithLink(deps, validSignUp("a@x.com"), "/");
    await vi.advanceTimersByTimeAsync(1500 * 3);
    expect(await second).toMatchObject({ ok: false, formError: COOLDOWN_MESSAGE });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("a rate limit store that fails", () => {
  const failing: RateLimiter = {
    peek: async () => {
      throw new Error("connection to postgres://user:pw@db failed for signup:email:a@x.com from 10.0.0.1");
    },
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
    const result = await signUpWithLink(deps, validSignUp("a@x.com"), "/");
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

/*
  A provider rate limit (Supabase's per-address, per-IP or project-wide email limit) means no
  email was sent. It used to be reported as the neutral "check your email"; now it is said
  honestly. The tests below show that our code treats known and unknown addresses alike when the
  provider refuses both, and our own one-a-minute cooldown keeps quick repeats (the case where
  Supabase's per-address limit would only hit known addresses) from reaching the provider. In real
  Supabase the provider's limit is only reached when an email is actually sent, so someone who
  deliberately drains the project's email quota could still learn which addresses have accounts.
  That is an accepted pilot risk, see "Known risks accepted for the pilot" in the Phase 1 spec.
*/
describe("a provider rate limit is reported honestly, the same for known and unknown addresses", () => {
  type Flow = "signUp" | "resend" | "reset";
  const methods = { signUp: "signUpWithPassword", resend: "resendConfirmation", reset: "sendPasswordReset" } as const;
  const run = (flow: Flow, deps: Deps, email: string) =>
    flow === "signUp"
      ? signUpWithLink(deps, validSignUp(email), "/")
      : flow === "resend"
        ? resendConfirmation(deps, { email }, "/")
        : requestPasswordResetLink(deps, { email });

  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it.each(["signUp", "resend", "reset"] as const)("%s: known and unknown addresses get the same honest error", async (flow) => {
    const { auth, deps } = setup();
    await registerConfirmed(auth, "known@x.com", "my password");
    vi.spyOn(auth, methods[flow]).mockRejectedValue(new AuthProviderError("rate_limited", "over_email_send_rate_limit"));
    const known = await run(flow, deps, "known@x.com");
    const unknown = await run(flow, deps, "ghost@x.com");
    expect(known).toEqual({ ok: false, formError: COULD_NOT_SEND });
    expect(unknown).toEqual(known);
  });

  it("logs one fixed line per refusal, with no email, key, IP or provider text", async () => {
    const { auth, deps } = setup();
    vi.spyOn(auth, "sendPasswordReset").mockRejectedValue(new AuthProviderError("rate_limited", "over_email_send_rate_limit"));
    await requestPasswordResetLink(deps, { email: "known@x.com" });
    expect(warn).toHaveBeenCalledTimes(1);
    const text = JSON.stringify(warn.mock.calls);
    for (const leak of ["known@x.com", "email-send:", "over_email_send_rate_limit", "10.0.0.1"]) expect(text).not.toContain(leak);
  });

  it("without any limit, an existing and a new address still get the identical neutral result", async () => {
    const { auth, deps } = setup();
    await registerConfirmed(auth, "known@x.com", "my password");
    for (const flow of ["signUp", "resend", "reset"] as const) {
      const known = await run(flow, deps, `known@x.com`);
      const fresh = await run(flow, deps, `${flow.toLowerCase()}-fresh@x.com`);
      expect(known.ok).toBe(true);
      expect(known).toEqual(fresh);
      deps.limiter = createMemoryRateLimiter();
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
    const { deps } = setup({ limiter: { hit, peek: allowPeek }, ip });
    await run(deps);
    return hit.mock.calls.map((c) => c[0].key);
  };

  it.each(["", "   "])("skips the per-IP limit when the address is unknown (%j)", async (ip) => {
    expect(await keysFor(ip, (d) => signUpWithLink(d, validSignUp("k@x.com"), "/"))).toEqual([
      "email-send:k@x.com",
      "signup:email:k@x.com",
    ]);
    expect(await keysFor(ip, (d) => logIn(d, { email: "k@x.com", password: "pw" }, "/"))).toEqual(["login:email:k@x.com"]);
    expect(await keysFor(ip, (d) => requestPasswordResetLink(d, { email: "k@x.com" }))).toEqual([
      "email-send:k@x.com",
      "reset:email:k@x.com",
    ]);
  });

  it("does not put everyone without an address into one bucket", async () => {
    const { deps } = setup({ ip: "" });
    for (let i = 0; i < 31; i++) expect((await signUpWithLink(deps, validSignUp(`u${i}@x.com`), "/")).ok).toBe(true);
  });

  it("trims the address and caps its length at 64 characters in the key", async () => {
    const long = "a".repeat(200);
    const [, , ipKey] = await keysFor(`  ${long}  `, (d) => signUpWithLink(d, validSignUp("k@x.com"), "/"));
    expect(ipKey).toBe(`signup:ip:${"a".repeat(64)}`);
    const [, loginIp] = await keysFor("1.2.3.4 ", (d) => logIn(d, { email: "k@x.com", password: "pw" }, "/"));
    expect(loginIp).toBe("login:ip:1.2.3.4");
  });
});

describe("logOut", () => {
  const stub = (signOut: () => Promise<void>) => ({ auth: { signOut } as unknown as Deps["auth"] });

  it("signs out once and succeeds", async () => {
    const signOut = vi.fn(async () => {});
    expect(await logOut(stub(signOut))).toEqual({ ok: true, data: undefined });
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("turns a provider failure into a plain message without vendor text, and logs one fixed line", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await logOut(stub(async () => Promise.reject(new AuthProviderError("unavailable", "supabase boom token=abc"))));
    expect(result).toEqual({ ok: false, formError: "We could not log you out. Please try again." });
    expect(JSON.stringify(result)).not.toMatch(/supabase|boom|token/);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0])).not.toMatch(/supabase|boom|token/);
    warn.mockRestore();
  });

  it("treats every provider error code the same way", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const code of ["rate_limited", "weak_password", "unavailable"] as const) {
      const result = await logOut(stub(async () => Promise.reject(new AuthProviderError(code))));
      expect(result.ok).toBe(false);
    }
    vi.restoreAllMocks();
  });

  it("rethrows anything that is not a provider error", async () => {
    const bug = new Error("a bug");
    await expect(logOut(stub(async () => Promise.reject(bug)))).rejects.toBe(bug);
  });
});

/* ------------------------------------------------------------------------------------------
   The code-based flows (registration redesign, spec sections 4, 5 and 6).
   Addresses are @example.invalid; the fake's one Google account is google.user@example.test.
------------------------------------------------------------------------------------------ */

const PW = "first password 1";
const PW2 = "second password 2";
const STRANGER_PW = "stranger password 9";
const GOOGLE_EMAIL = "google.user@example.test";

type Ctx = ReturnType<typeof setup>;

const signUpInput = (email: string, password = PW, displayName = "Asha Rao") => ({
  displayName,
  email,
  password,
  acceptTerms: true,
});

const codeFor = (auth: Ctx["auth"], email: string) => auth.outbox.lastCodeFor(email)!.code;
const wrongCode = (code: string) => (code === "000000" ? "111111" : "000000");

/** Every user the store holds for an address (there must never be two). */
const usersFor = (store: FakeAuthStore, email: string) => [...store.users.values()].filter((u) => u.email === email);

/** Spies on `obj[name]`, recording each call's name in `order` before running the real method. */
function trace<T extends object, K extends keyof T & string>(order: string[], obj: T, name: K) {
  const real = (obj[name] as (...a: unknown[]) => unknown).bind(obj);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return vi.spyOn(obj as any, name).mockImplementation((...args: unknown[]) => {
    order.push(name);
    return real(...args);
  });
}

/** Signs up through the use-case and remembers the pending cookie, as the action will. */
async function signUpInBrowser(ctx: Ctx, email: string, password = PW, name = "Asha Rao") {
  const result = await signUp(ctx.deps, signUpInput(email, password, name), "/");
  if (!result.ok) throw new Error(`sign-up failed: ${JSON.stringify(result)}`);
  ctx.deps.pending = { userId: result.data.pendingUserId, email: result.data.email };
  return result.data;
}

/** A confirmed password account, made through the code flow, then signed out. */
async function confirmedAccount(ctx: Ctx, email: string, password = PW, name = "Asha Rao") {
  await signUpInBrowser(ctx, email, password, name);
  const verified = await verifySignUpCode(ctx.deps, { email, code: codeFor(ctx.auth, email) }, "/");
  if (!verified.ok) throw new Error("verify failed");
  await ctx.auth.signOut();
  ctx.deps.pending = null;
  ctx.advance(PAST_COOLDOWN);
}

describe("AUTH_MESSAGES: the wording the spec fixes", () => {
  it("keeps the spec's exact sentences", () => {
    expect(AUTH_MESSAGES.emailTaken).toBe("This email already has an account. Log in or reset your password.");
    expect(AUTH_MESSAGES.googleOnly).toBe("This email is registered with Google. Continue with Google, or reset your password to add one.");
    expect(AUTH_MESSAGES.codeInvalid).toBe("That code is wrong or has expired. Request a new one.");
    expect(AUTH_MESSAGES.tooManyCodes).toBe("Too many wrong codes. Try again in 15 minutes.");
    expect(AUTH_MESSAGES.confirmedSetPassword).toBe("Your email is confirmed. Set a password with Forgot password to log in.");
    expect(AUTH_MESSAGES.googleFailed).toBe("Something went wrong signing you in with Google. Please try again.");
  });
});

describe("signUp (codes)", () => {
  it("creates a pending account, emails a code (no link) and returns the pending id", async () => {
    const ctx = setup();
    const spy = vi.spyOn(ctx.auth, "signUpWithPassword");
    const result = await signUp(ctx.deps, signUpInput(" New@Example.invalid "), "/");
    const state = await ctx.directory.describeEmail("new@example.invalid");
    expect(state.kind).toBe("pending");
    expect(result).toEqual({ ok: true, data: { pendingUserId: state.kind === "pending" && state.userId, email: "new@example.invalid" } });
    expect(spy).toHaveBeenCalledWith({ email: "new@example.invalid", password: PW, displayName: "Asha Rao", termsVersion: TERMS_VERSION });
    expect(ctx.auth.outbox.lastCodeFor("new@example.invalid")?.purpose).toBe("signup");
    expect(ctx.auth.outbox.lastFor("new@example.invalid")).toBeUndefined();
  });

  it("does not trust the provider's id: an empty id still returns the directory's pending id", async () => {
    const ctx = setup();
    const real = ctx.auth.signUpWithPassword.bind(ctx.auth);
    vi.spyOn(ctx.auth, "signUpWithPassword").mockImplementation(async (i) => {
      await real(i);
      return { userId: "" };
    });
    const result = await signUp(ctx.deps, signUpInput("a@example.invalid"), "/");
    expect(result.ok && result.data.pendingUserId).toBe(usersFor(ctx.store, "a@example.invalid")[0].id);
  });

  it("tells a confirmed account clearly and creates or sends nothing", async () => {
    const ctx = setup();
    await confirmedAccount(ctx, "taken@example.invalid");
    const emails = ctx.auth.outbox.entries.length;
    const create = vi.spyOn(ctx.auth, "signUpWithPassword");
    const remove = vi.spyOn(ctx.directory, "removePendingSignup");
    const result = await signUp(ctx.deps, signUpInput("taken@example.invalid", PW2), "/");
    expect(result).toEqual({ ok: false, formError: AUTH_MESSAGES.emailTaken });
    expect(create).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(ctx.auth.outbox.entries).toHaveLength(emails);
  });

  it("gives the Google message for a Google-only account, also once it holds a (random) password", async () => {
    const ctx = setup();
    const { url } = await ctx.auth.startGoogleSignIn({ redirectTo: SITE });
    await ctx.auth.completeOAuth(new URL(url, SITE).searchParams.get("code")!);
    await ctx.auth.signOut();
    const create = vi.spyOn(ctx.auth, "signUpWithPassword");
    expect(await signUp(ctx.deps, signUpInput(GOOGLE_EMAIL), "/")).toEqual({ ok: false, formError: AUTH_MESSAGES.googleOnly });
    // A repaired or scrambled Google account reads as "has a password" (port doc): still Google.
    await ctx.auth.scramblePassword(usersFor(ctx.store, GOOGLE_EMAIL)[0].id);
    ctx.advance(PAST_COOLDOWN);
    expect(await signUp(ctx.deps, signUpInput(GOOGLE_EMAIL), "/")).toEqual({ ok: false, formError: AUTH_MESSAGES.googleOnly });
    expect(create).not.toHaveBeenCalled();
  });

  it("gives the account message (not Google) for a password account that also uses Google", async () => {
    const ctx = setup();
    await confirmedAccount(ctx, GOOGLE_EMAIL);
    const { url } = await ctx.auth.startGoogleSignIn({ redirectTo: SITE });
    await ctx.auth.completeOAuth(new URL(url, SITE).searchParams.get("code")!);
    await ctx.auth.signOut();
    expect(await signUp(ctx.deps, signUpInput(GOOGLE_EMAIL), "/")).toEqual({ ok: false, formError: AUTH_MESSAGES.emailTaken });
  });

  it("replaces an unconfirmed sign-up: the newest password is the one on the account", async () => {
    const ctx = setup();
    await ctx.auth.signUpWithPassword({ email: "a@example.invalid", password: STRANGER_PW, displayName: "Stranger", termsVersion: TERMS_VERSION });
    const oldId = usersFor(ctx.store, "a@example.invalid")[0].id;
    const result = await signUp(ctx.deps, signUpInput("a@example.invalid", PW), "/");
    expect(result.ok).toBe(true);
    const users = usersFor(ctx.store, "a@example.invalid");
    expect(users).toHaveLength(1);
    expect(users[0].id).not.toBe(oldId);
    expect(result.ok && result.data.pendingUserId).toBe(users[0].id);
    expect(users[0].displayName).toBe("Asha Rao");
    expect(await ctx.auth.signInWithPassword({ email: "a@example.invalid", password: PW })).toEqual({ ok: false, reason: "email_not_confirmed" });
    expect(await ctx.auth.signInWithPassword({ email: "a@example.invalid", password: STRANGER_PW })).toEqual({
      ok: false,
      reason: "invalid_credentials",
    });
  });

  it("never hands out the id of an account that replaced ours right after the self-check passed", async () => {
    const ctx = setup();
    const stranger = browser(ctx.store);
    const strangerDirectory = createFakeAccountDirectory(ctx.store);
    const real = ctx.auth.signInWithPassword.bind(ctx.auth);
    vi.spyOn(ctx.auth, "signInWithPassword").mockImplementationOnce(async (i) => {
      const answer = await real(i);
      // Between our self-check and our final read, a stranger replaces the pending account.
      await strangerDirectory.removePendingSignup(i.email);
      await stranger.signUpWithPassword({ email: i.email, password: STRANGER_PW, displayName: "Stranger", termsVersion: TERMS_VERSION });
      return answer;
    });
    const result = await signUp(ctx.deps, signUpInput("a@example.invalid", PW), "/");
    expect(result.ok).toBe(true);
    // The id handed out (the cookie's) is an account whose password is the one this person typed.
    const users = usersFor(ctx.store, "a@example.invalid");
    expect(users).toHaveLength(1);
    expect(result.ok && result.data.pendingUserId).toBe(users[0].id);
    expect(await ctx.auth.signInWithPassword({ email: "a@example.invalid", password: PW })).toEqual({ ok: false, reason: "email_not_confirmed" });
  });

  it("when the self-check fails (someone else's password got there first) it removes and recreates once", async () => {
    const ctx = setup();
    const real = ctx.auth.signUpWithPassword.bind(ctx.auth);
    const create = vi.spyOn(ctx.auth, "signUpWithPassword").mockImplementationOnce(async (i) => {
      // A stranger's sign-up lands just before ours; the provider keeps the FIRST password.
      await real({ ...i, password: STRANGER_PW, displayName: "Stranger" });
      return real(i);
    });
    const remove = vi.spyOn(ctx.directory, "removePendingSignup");
    const result = await signUp(ctx.deps, signUpInput("a@example.invalid", PW), "/");
    expect(result.ok).toBe(true);
    expect(create).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenCalledTimes(1);
    const users = usersFor(ctx.store, "a@example.invalid");
    expect(users).toHaveLength(1);
    expect(result.ok && result.data.pendingUserId).toBe(users[0].id);
    expect(await ctx.auth.signInWithPassword({ email: "a@example.invalid", password: PW })).toEqual({ ok: false, reason: "email_not_confirmed" });
    expect(await ctx.auth.signInWithPassword({ email: "a@example.invalid", password: STRANGER_PW })).toEqual({
      ok: false,
      reason: "invalid_credentials",
    });
  });

  it("gives up with a plain error when the self-check fails twice", async () => {
    const ctx = setup();
    const real = ctx.auth.signUpWithPassword.bind(ctx.auth);
    const create = vi.spyOn(ctx.auth, "signUpWithPassword").mockImplementation(async (i) => {
      await real({ ...i, password: STRANGER_PW });
      return real(i);
    });
    const result = await signUp(ctx.deps, signUpInput("a@example.invalid", PW), "/");
    expect(result).toEqual({ ok: false, formError: AUTH_MESSAGES.generic });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("two sign-ups at the same moment leave exactly one pending account, and only its owner's result names it", async () => {
    const store = createFakeAuthStore();
    const allowAll: RateLimiter = { hit: allowPeek, peek: allowPeek };
    const a = setup({ limiter: allowAll, ip: "10.0.0.1" }, store);
    const b = setup({ limiter: allowAll, ip: "10.0.0.2" }, store);
    const results = await Promise.all([
      signUp(a.deps, signUpInput("race@example.invalid", PW), "/"),
      signUp(b.deps, signUpInput("race@example.invalid", PW2), "/"),
    ]);
    const users = usersFor(store, "race@example.invalid");
    expect(users).toHaveLength(1);
    const survivor = users[0].id;
    const passwords = [PW, PW2];
    const winners = results.flatMap((r, i) => (r.ok && r.data.pendingUserId === survivor ? [passwords[i]] : []));
    expect(winners).toHaveLength(1);
    expect(await a.auth.signInWithPassword({ email: "race@example.invalid", password: winners[0] })).toEqual({
      ok: false,
      reason: "email_not_confirmed",
    });
    // The other submitter's cookie (if it got one) names an account that no longer exists.
    for (const r of results) if (r.ok && r.data.pendingUserId !== survivor) expect(store.users.has(r.data.pendingUserId)).toBe(false);
  });

  it("returns field errors and calls nothing for invalid input", async () => {
    const ctx = setup();
    const hit = vi.spyOn(ctx.deps.limiter, "hit");
    const lookup = vi.spyOn(ctx.directory, "describeEmail");
    const result = await signUp(ctx.deps, { displayName: "A", email: "nope", password: "short", acceptTerms: false }, "/");
    expect(!result.ok && Object.keys(result.fieldErrors ?? {}).sort()).toEqual(["acceptTerms", "displayName", "email", "password"]);
    expect(hit).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
  });

  it("keeps the shared one-email-a-minute cooldown, also in front of the lookup of a registered address", async () => {
    const ctx = setup();
    await confirmedAccount(ctx, "taken@example.invalid");
    expect(await signUp(ctx.deps, signUpInput("taken@example.invalid"), "/")).toMatchObject({ formError: AUTH_MESSAGES.emailTaken });
    const lookup = vi.spyOn(ctx.directory, "describeEmail");
    expect(await signUp(ctx.deps, signUpInput("taken@example.invalid"), "/")).toEqual({
      ok: false,
      formError: COOLDOWN_MESSAGE,
      retryAfterSeconds: 60,
    });
    expect(lookup).not.toHaveBeenCalled();
    expect((await signUp(ctx.deps, signUpInput("new@example.invalid"), "/")).ok).toBe(true);
    expect(await signUp(ctx.deps, signUpInput("new@example.invalid"), "/")).toMatchObject({ formError: COOLDOWN_MESSAGE });
  });

  it("uses the same namespaced limit keys as before", async () => {
    const hit = vi.fn<RateLimiter["hit"]>(async () => ({ allowed: true, retryAfterSeconds: 0 }));
    const { deps } = setup({ limiter: { hit, peek: allowPeek } });
    await signUp(deps, signUpInput("k@example.invalid"), "/");
    expect(hit.mock.calls.map((c) => c[0].key)).toEqual(["email-send:k@example.invalid", "signup:email:k@example.invalid", "signup:ip:10.0.0.1"]);
  });

  it("says honestly that no email was sent when the provider rate limits", async () => {
    const ctx = setup();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(ctx.auth, "signUpWithPassword").mockRejectedValue(new AuthProviderError("rate_limited", "vendor text"));
    expect(await signUp(ctx.deps, signUpInput("a@example.invalid"), "/")).toEqual({ ok: false, formError: COULD_NOT_SEND });
    warn.mockRestore();
  });

  it("an outage of the account directory is a plain error with one fixed warning", async () => {
    const ctx = setup();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(ctx.directory, "describeEmail").mockRejectedValue(new Error("connect ECONNREFUSED a@example.invalid"));
    expect(await signUp(ctx.deps, signUpInput("a@example.invalid"), "/")).toEqual({ ok: false, formError: AUTH_MESSAGES.generic });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("example.invalid");
    warn.mockRestore();
  });
});

describe("verifySignUpCode", () => {
  it("accepts a code with spaces and dashes; a matching cookie signs in without a password step", async () => {
    const ctx = setup();
    const { pendingUserId } = await signUpInBrowser(ctx, "me@example.invalid");
    const code = codeFor(ctx.auth, "me@example.invalid");
    const scramble = vi.spyOn(ctx.auth, "scramblePassword");
    const result = await verifySignUpCode(
      ctx.deps,
      { email: "me@example.invalid", code: ` ${code.slice(0, 3)} - ${code.slice(3)} ` },
      "/groups/1",
    );
    expect(result).toEqual({ ok: true, data: { redirectTo: "/groups/1", needsPassword: false } });
    expect((await ctx.auth.getUser())?.id).toBe(pendingUserId);
    expect(scramble).not.toHaveBeenCalled();
    await ctx.auth.signOut();
    expect(await ctx.auth.signInWithPassword({ email: "me@example.invalid", password: PW })).toEqual({ ok: true });
  });

  it("turns an unsafe next into /", async () => {
    const ctx = setup();
    await signUpInBrowser(ctx, "me@example.invalid");
    const result = await verifySignUpCode(ctx.deps, { email: "me@example.invalid", code: codeFor(ctx.auth, "me@example.invalid") }, "//evil.example");
    expect(result.ok && result.data.redirectTo).toBe("/");
  });

  it.each([["12345"], ["1234567"], ["12a456"], ["١٢٣٤٥٦"], [""], [undefined], [123456]])(
    "refuses %j before counting or calling the provider",
    async (code) => {
      const ctx = setup();
      const verify = vi.spyOn(ctx.auth, "verifyCode");
      const hit = vi.spyOn(ctx.deps.limiter, "hit");
      const result = await verifySignUpCode(ctx.deps, { email: "me@example.invalid", code }, "/");
      expect(!result.ok && result.fieldErrors?.code).toBe(AUTH_MESSAGES.codeFormat);
      expect(verify).not.toHaveBeenCalled();
      expect(hit).not.toHaveBeenCalled();
    },
  );

  it("needs an address when there is no cookie", async () => {
    const ctx = setup();
    const verify = vi.spyOn(ctx.auth, "verifyCode");
    const result = await verifySignUpCode(ctx.deps, { email: "nope", code: "123456" }, "/");
    expect(!result.ok && result.fieldErrors?.email).toBeTruthy();
    expect(verify).not.toHaveBeenCalled();
  });

  it("acts on the cookie's address when there is a cookie", async () => {
    const ctx = setup();
    await signUpInBrowser(ctx, "me@example.invalid");
    const verify = vi.spyOn(ctx.auth, "verifyCode");
    await verifySignUpCode(ctx.deps, { email: "other@example.invalid", code: codeFor(ctx.auth, "me@example.invalid") }, "/");
    expect(verify).toHaveBeenCalledWith(expect.objectContaining({ email: "me@example.invalid", kind: "signup" }));
  });

  it("a wrong, used or expired code gets the one message", async () => {
    const ctx = setup();
    await signUpInBrowser(ctx, "me@example.invalid");
    const code = codeFor(ctx.auth, "me@example.invalid");
    const wrong = await verifySignUpCode(ctx.deps, { email: "me@example.invalid", code: wrongCode(code) }, "/");
    expect(wrong).toEqual({ ok: false, formError: AUTH_MESSAGES.codeInvalid });
    expireAllCodes(ctx.store);
    expect(await verifySignUpCode(ctx.deps, { email: "me@example.invalid", code }, "/")).toEqual(wrong);
    expect(await ctx.auth.getUser()).toBeNull();
  });

  it("a provider limit or outage is not reported as a wrong code", async () => {
    const ctx = setup();
    await signUpInBrowser(ctx, "me@example.invalid");
    const verify = vi.spyOn(ctx.auth, "verifyCode");
    verify.mockRejectedValueOnce(new AuthProviderError("rate_limited", "vendor"));
    const limited = await verifySignUpCode(ctx.deps, { email: "me@example.invalid", code: "123456" }, "/");
    verify.mockRejectedValueOnce(new AuthProviderError("unavailable", "vendor"));
    const down = await verifySignUpCode(ctx.deps, { email: "me@example.invalid", code: "123456" }, "/");
    expect(limited).toEqual({ ok: false, formError: AUTH_MESSAGES.tooMany });
    expect(down).toEqual({ ok: false, formError: AUTH_MESSAGES.codeCheckUnavailable });
    for (const r of [limited, down]) expect(JSON.stringify(r)).not.toMatch(/vendor|wrong or has expired/);
  });

  describe("a code that confirms an account this browser did not create (spec 5.1, Review Focus 1)", () => {
    /** The victim signs up first; a stranger signs up the same address just after, from another browser. */
    async function strangerSignsUpAfterVictim() {
      const store = createFakeAuthStore();
      const victim = setup({}, store);
      // Each browser has its own limiter here, so the stranger is not held up by the victim's cooldown.
      const stranger = setup({ ip: "10.9.9.9" }, store);
      const victimSignUp = await signUpInBrowser(victim, "victim@example.invalid", PW);
      const strangerSignUp = await signUpInBrowser(stranger, "victim@example.invalid", STRANGER_PW, "Stranger");
      expect(strangerSignUp.pendingUserId).not.toBe(victimSignUp.pendingUserId);
      return { store, victim, strangerId: strangerSignUp.pendingUserId };
    }

    it("scrambles, then opens a fresh session for that user, and asks for a new password", async () => {
      const { store, victim, strangerId } = await strangerSignsUpAfterVictim();
      const order: string[] = [];
      trace(order, victim.auth, "verifyCode");
      const scramble = trace(order, victim.auth, "scramblePassword");
      const open = trace(order, victim.auth, "openSessionWithoutEmail");

      // The victim's inbox now holds the code for the stranger's pending account.
      const code = codeFor(victim.auth, "victim@example.invalid");
      const result = await verifySignUpCode(victim.deps, { email: "victim@example.invalid", code }, "/");

      expect(result).toEqual({ ok: true, data: { redirectTo: "/", needsPassword: true } });
      expect(order).toEqual(["verifyCode", "scramblePassword", "openSessionWithoutEmail"]);
      expect(scramble).toHaveBeenCalledWith(strangerId);
      expect(open).toHaveBeenCalledWith({ email: "victim@example.invalid", expectedUserId: strangerId });
      // The stranger's password is dead, and only the fresh session in the victim's browser exists.
      expect(await victim.auth.signInWithPassword({ email: "victim@example.invalid", password: STRANGER_PW })).toEqual({
        ok: false,
        reason: "invalid_credentials",
      });
      expect((await victim.auth.getUser())?.id).toBe(strangerId);
      expect([...store.sessions.values()].filter((s) => s.userId === strangerId)).toHaveLength(1);

      // The forced password step works from that session; then only the victim's password works.
      expect((await setPassword(victim.deps, { password: PW2, confirmPassword: PW2 })).ok).toBe(true);
      await victim.auth.signOut();
      expect(await victim.auth.signInWithPassword({ email: "victim@example.invalid", password: PW2 })).toEqual({ ok: true });
      await victim.auth.signOut();
      expect(await victim.auth.signInWithPassword({ email: "victim@example.invalid", password: STRANGER_PW })).toEqual({
        ok: false,
        reason: "invalid_credentials",
      });
    });

    it("does the same when there is no cookie (another device or a cleared browser)", async () => {
      const ctx = setup();
      const { pendingUserId } = await signUpInBrowser(ctx, "me@example.invalid");
      ctx.deps.pending = null;
      const scramble = vi.spyOn(ctx.auth, "scramblePassword");
      const result = await verifySignUpCode(ctx.deps, { email: "me@example.invalid", code: codeFor(ctx.auth, "me@example.invalid") }, "/");
      expect(result).toEqual({ ok: true, data: { redirectTo: "/", needsPassword: true } });
      expect(scramble).toHaveBeenCalledWith(pendingUserId);
      expect(await ctx.auth.signInWithPassword({ email: "me@example.invalid", password: PW })).toEqual({
        ok: false,
        reason: "invalid_credentials",
      });
    });

    it("starts the app's email cooldown at once: a resend or Forgot password straight after gets the countdown", async () => {
      const ctx = setup();
      await signUpInBrowser(ctx, "me@example.invalid");
      ctx.deps.pending = null;
      ctx.advance(PAST_COOLDOWN);
      const code = codeFor(ctx.auth, "me@example.invalid");
      expect((await verifySignUpCode(ctx.deps, { email: "me@example.invalid", code }, "/")).ok).toBe(true);
      const resend = vi.spyOn(ctx.auth, "resendSignUpCode");
      const reset = vi.spyOn(ctx.auth, "sendPasswordResetCode");
      expect(await resendSignUpCode(ctx.deps, { email: "me@example.invalid" })).toEqual({
        ok: false,
        formError: COOLDOWN_MESSAGE,
        retryAfterSeconds: 60,
      });
      expect(await requestPasswordReset(ctx.deps, { email: "me@example.invalid" })).toMatchObject({ ok: false, formError: COOLDOWN_MESSAGE });
      expect(resend).not.toHaveBeenCalled();
      expect(reset).not.toHaveBeenCalled();
    });

    it("if the fresh session cannot be opened, the password stays random, the person is signed out and pointed to Forgot password", async () => {
      const ctx = setup();
      await signUpInBrowser(ctx, "me@example.invalid");
      ctx.deps.pending = null;
      ctx.advance(PAST_COOLDOWN);
      vi.spyOn(ctx.auth, "openSessionWithoutEmail").mockRejectedValue(new AuthProviderError("unavailable", "vendor"));
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const result = await verifySignUpCode(ctx.deps, { email: "me@example.invalid", code: codeFor(ctx.auth, "me@example.invalid") }, "/");
      expect(result).toEqual({ ok: false, formError: AUTH_MESSAGES.confirmedSetPassword });
      expect(await ctx.auth.getUser()).toBeNull();
      expect(await ctx.auth.signInWithPassword({ email: "me@example.invalid", password: PW })).toEqual({
        ok: false,
        reason: "invalid_credentials",
      });
      // The cooldown was started anyway (the provider may have recorded a recovery request).
      expect(await requestPasswordReset(ctx.deps, { email: "me@example.invalid" })).toMatchObject({ formError: COOLDOWN_MESSAGE });
      expect(JSON.stringify(warn.mock.calls)).not.toMatch(/example\.invalid|vendor/);
      warn.mockRestore();
    });

    it("if the scramble fails twice, it replaces the password from the code session, then signs out and points to Forgot password", async () => {
      const ctx = setup();
      await signUpInBrowser(ctx, "me@example.invalid");
      ctx.deps.pending = null;
      const scramble = vi.spyOn(ctx.auth, "scramblePassword").mockRejectedValue(new AuthProviderError("unavailable"));
      const update = vi.spyOn(ctx.auth, "updatePassword");
      const open = vi.spyOn(ctx.auth, "openSessionWithoutEmail");
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const result = await verifySignUpCode(ctx.deps, { email: "me@example.invalid", code: codeFor(ctx.auth, "me@example.invalid") }, "/");
      expect(result).toEqual({ ok: false, formError: AUTH_MESSAGES.confirmedSetPassword });
      expect(scramble).toHaveBeenCalledTimes(2);
      expect(update).toHaveBeenCalledTimes(1);
      const random = update.mock.calls[0][0];
      expect(random.length).toBeGreaterThanOrEqual(43);
      expect(random).not.toBe(PW);
      expect(open).not.toHaveBeenCalled();
      expect(await ctx.auth.getUser()).toBeNull();
      // The password the creator typed (a stranger's, in the attack) no longer works.
      expect(await ctx.auth.signInWithPassword({ email: "me@example.invalid", password: PW })).toEqual({
        ok: false,
        reason: "invalid_credentials",
      });
      expect(warn.mock.calls.map((c) => c[0])).not.toContain(PASSWORD_NOT_REPLACED_WARNING);
      expect(JSON.stringify(warn.mock.calls)).not.toContain(random);
      warn.mockRestore();
    });

    it("if both ways of replacing the password fail, it signs out and logs the distinct warning line", async () => {
      const ctx = setup();
      await signUpInBrowser(ctx, "me@example.invalid");
      ctx.deps.pending = null;
      vi.spyOn(ctx.auth, "scramblePassword").mockRejectedValue(new AuthProviderError("unavailable", "vendor"));
      vi.spyOn(ctx.auth, "updatePassword").mockRejectedValue(new AuthProviderError("unavailable", "vendor"));
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const result = await verifySignUpCode(ctx.deps, { email: "me@example.invalid", code: codeFor(ctx.auth, "me@example.invalid") }, "/");
      expect(result).toEqual({ ok: false, formError: AUTH_MESSAGES.confirmedSetPassword });
      expect(await ctx.auth.getUser()).toBeNull();
      expect(warn.mock.calls.map((c) => c[0])).toContain(PASSWORD_NOT_REPLACED_WARNING);
      expect(PASSWORD_NOT_REPLACED_WARNING).toMatch(/^SECURITY:/);
      expect(JSON.stringify(warn.mock.calls)).not.toMatch(/example\.invalid|vendor/);
      warn.mockRestore();
    });

    it("the cooldown also covers sign-up on one device and the code on another within the minute (no clock jump)", async () => {
      const store = createFakeAuthStore();
      const first = setup({}, store);
      // The second device shares the server's limiter but has its own cookies and no pending cookie.
      const secondAuth = browser(store);
      const secondDeps: Deps = { ...first.deps, auth: secondAuth, pending: null };
      await signUpInBrowser(first, "me@example.invalid");
      first.advance(30);
      const code = codeFor(first.auth, "me@example.invalid");
      expect((await verifySignUpCode(secondDeps, { email: "me@example.invalid", code }, "/")).ok).toBe(true);

      const reset = vi.spyOn(secondAuth, "sendPasswordResetCode");
      const resend = vi.spyOn(secondAuth, "resendSignUpCode");
      const create = vi.spyOn(secondAuth, "signUpWithPassword");
      const cooldown = { ok: false, formError: COOLDOWN_MESSAGE, retryAfterSeconds: 60 };
      expect(await requestPasswordReset(secondDeps, { email: "me@example.invalid" })).toEqual(cooldown);
      expect(await resendSignUpCode(secondDeps, { email: "me@example.invalid" })).toEqual(cooldown);
      expect(await signUp(secondDeps, signUpInput("me@example.invalid"), "/")).toEqual(cooldown);
      // Past the sign-up's own one-minute window, but still within a minute of the minted session.
      first.advance(31);
      expect(await requestPasswordReset(secondDeps, { email: "me@example.invalid" })).toEqual({ ...cooldown, retryAfterSeconds: 29 });
      expect(reset).not.toHaveBeenCalled();
      expect(resend).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
      first.advance(29);
      expect(await requestPasswordReset(secondDeps, { email: "me@example.invalid" })).toEqual({
        ok: true,
        data: { email: "me@example.invalid" },
      });
      expect(reset).toHaveBeenCalledTimes(1);
    });
  });

  it("5 wrong codes lock the address for 15 minutes, even after a resend; a correct code during the lock is refused", async () => {
    const ctx = setup();
    await signUpInBrowser(ctx, "me@example.invalid");
    const verify = vi.spyOn(ctx.auth, "verifyCode");
    for (let i = 0; i < 5; i++) {
      const code = codeFor(ctx.auth, "me@example.invalid");
      expect(await verifySignUpCode(ctx.deps, { email: "me@example.invalid", code: wrongCode(code) }, "/")).toEqual({
        ok: false,
        formError: AUTH_MESSAGES.codeInvalid,
      });
    }
    ctx.advance(PAST_COOLDOWN);
    expect((await resendSignUpCode(ctx.deps, {})).ok).toBe(true);
    const fresh = codeFor(ctx.auth, "me@example.invalid");
    const locked = await verifySignUpCode(ctx.deps, { email: "me@example.invalid", code: fresh }, "/");
    expect(locked).toMatchObject({ ok: false, formError: AUTH_MESSAGES.tooManyCodes });
    expect(!locked.ok && locked.retryAfterSeconds).toBeGreaterThan(0);
    expect(verify).toHaveBeenCalledTimes(5);
    ctx.advance(15 * 60);
    expect(await verifySignUpCode(ctx.deps, { email: "me@example.invalid", code: fresh }, "/")).toMatchObject({ ok: true });
  });

  it("counts per address and per IP with namespaced keys", async () => {
    const hit = vi.fn<RateLimiter["hit"]>(async () => ({ allowed: true, retryAfterSeconds: 0 }));
    const { deps } = setup({ limiter: { hit, peek: allowPeek } });
    await verifySignUpCode(deps, { email: "k@example.invalid", code: "123456" }, "/");
    expect(hit.mock.calls.map((c) => [c[0].key, c[0].limit, c[0].windowSeconds])).toEqual([
      ["code:email:k@example.invalid", 5, 900],
      ["code:ip:10.0.0.1", 30, 3600],
    ]);
  });

  it("a failing limiter fails open with the one fixed warning", async () => {
    const down = async () => Promise.reject(new Error("db down for code:email:me@example.invalid"));
    const failing: RateLimiter = { hit: down, peek: down };
    const ctx = setup();
    await signUpInBrowser(ctx, "me@example.invalid");
    ctx.deps.limiter = failing;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await verifySignUpCode(ctx.deps, { email: "me@example.invalid", code: codeFor(ctx.auth, "me@example.invalid") }, "/");
    expect(result).toMatchObject({ ok: true, data: { needsPassword: false } });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBe("Rate limit store unavailable; allowing the request.");
    warn.mockRestore();
  });

  it("the same code submitted twice: the second gets the one message and changes nothing", async () => {
    const ctx = setup();
    await signUpInBrowser(ctx, "me@example.invalid");
    const code = codeFor(ctx.auth, "me@example.invalid");
    expect((await verifySignUpCode(ctx.deps, { email: "me@example.invalid", code }, "/")).ok).toBe(true);
    const scramble = vi.spyOn(ctx.auth, "scramblePassword");
    expect(await verifySignUpCode(ctx.deps, { email: "me@example.invalid", code }, "/")).toEqual({
      ok: false,
      formError: AUTH_MESSAGES.codeInvalid,
    });
    expect(scramble).not.toHaveBeenCalled();
    expect(await ctx.auth.getUser()).not.toBeNull();
  });
});

describe("resendSignUpCode", () => {
  it("sends a new code to the cookie's address; the earlier code stops working", async () => {
    const ctx = setup();
    await signUpInBrowser(ctx, "me@example.invalid");
    const before = ctx.auth.outbox.entries.length;
    ctx.advance(PAST_COOLDOWN);
    const send = vi.spyOn(ctx.auth, "resendSignUpCode");
    expect(await resendSignUpCode(ctx.deps, { email: "ignored@example.invalid" })).toEqual({ ok: true, data: undefined });
    expect(send).toHaveBeenCalledWith({ email: "me@example.invalid" });
    expect(ctx.auth.outbox.entries).toHaveLength(before + 1);
  });

  it("keeps the cooldown, is neutral for unknown addresses and validates without a cookie", async () => {
    const ctx = setup();
    expect(await resendSignUpCode(ctx.deps, { email: "ghost@example.invalid" })).toEqual({ ok: true, data: undefined });
    expect(await resendSignUpCode(ctx.deps, { email: "ghost@example.invalid" })).toMatchObject({ formError: COOLDOWN_MESSAGE });
    const bad = await resendSignUpCode(ctx.deps, { email: "nope" });
    expect(!bad.ok && bad.fieldErrors?.email).toBeTruthy();
  });

  it("a provider rate limit gives the honest could-not-send result", async () => {
    const ctx = setup();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(ctx.auth, "resendSignUpCode").mockRejectedValue(new AuthProviderError("rate_limited"));
    expect(await resendSignUpCode(ctx.deps, { email: "me@example.invalid" })).toEqual({ ok: false, formError: COULD_NOT_SEND });
    warn.mockRestore();
  });
});

describe("requestPasswordReset (codes)", () => {
  it("answers known and unknown addresses identically, and emails a code only to the known one", async () => {
    const ctx = setup();
    await confirmedAccount(ctx, "known@example.invalid");
    const known = await requestPasswordReset(ctx.deps, { email: "Known@example.invalid" });
    const unknown = await requestPasswordReset(ctx.deps, { email: "ghost@example.invalid" });
    expect(known).toEqual({ ok: true, data: { email: "known@example.invalid" } });
    expect(unknown).toEqual({ ok: true, data: { email: "ghost@example.invalid" } });
    expect(ctx.auth.outbox.lastCodeFor("known@example.invalid")?.purpose).toBe("recovery");
    expect(ctx.auth.outbox.lastCodeFor("ghost@example.invalid")).toBeUndefined();
  });

  it("a provider rate limit gets the same neutral reply as an unknown address", async () => {
    const ctx = setup();
    await confirmedAccount(ctx, "known@example.invalid");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const send = vi.spyOn(ctx.auth, "sendPasswordResetCode").mockRejectedValueOnce(new AuthProviderError("rate_limited", "vendor"));
    const limited = await requestPasswordReset(ctx.deps, { email: "known@example.invalid" });
    const unknown = await requestPasswordReset(ctx.deps, { email: "ghost@example.invalid" });
    expect(send).toHaveBeenCalledTimes(2);
    // Identical apart from the echoed address the person typed.
    expect(limited).toEqual({ ok: true, data: { email: "known@example.invalid" } });
    expect(unknown).toEqual({ ok: true, data: { email: "ghost@example.invalid" } });
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/example\.invalid|vendor/);
    warn.mockRestore();
  });

  it("keeps the cooldown and the hourly limit", async () => {
    const ctx = setup();
    const send = vi.spyOn(ctx.auth, "sendPasswordResetCode");
    for (let i = 0; i < 3; i++) {
      expect((await requestPasswordReset(ctx.deps, { email: "a@example.invalid" })).ok).toBe(true);
      expect(await requestPasswordReset(ctx.deps, { email: "a@example.invalid" })).toMatchObject({ formError: COOLDOWN_MESSAGE });
      ctx.advance(PAST_COOLDOWN);
    }
    expect(await requestPasswordReset(ctx.deps, { email: "a@example.invalid" })).toMatchObject({ ok: false, formError: AUTH_MESSAGES.tooMany });
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("an outage is a plain error without vendor text", async () => {
    const ctx = setup();
    vi.spyOn(ctx.auth, "sendPasswordResetCode").mockRejectedValue(new AuthProviderError("unavailable", "vendor"));
    expect(await requestPasswordReset(ctx.deps, { email: "a@example.invalid" })).toEqual({ ok: false, formError: AUTH_MESSAGES.generic });
  });
});

describe("verifyResetCode and setPassword", () => {
  async function knownAccount() {
    const ctx = setup();
    await confirmedAccount(ctx, "me@example.invalid", PW);
    // Let the wrong-code window the confirmation counted in run out.
    ctx.advance(15 * 60);
    return ctx;
  }

  /** Requests a reset and redeems its code, so this browser holds a recovery session. */
  async function recoverySession(ctx: Ctx) {
    expect((await requestPasswordReset(ctx.deps, { email: "me@example.invalid" })).ok).toBe(true);
    const verified = await verifyResetCode(ctx.deps, { email: "me@example.invalid", code: codeFor(ctx.auth, "me@example.invalid") });
    expect(verified).toEqual({ ok: true, data: undefined });
  }

  it("a reset code signs in; the new password works, the old one does not, and other devices are signed out", async () => {
    const ctx = await knownAccount();
    const other = setup({}, ctx.store);
    expect(await other.auth.signInWithPassword({ email: "me@example.invalid", password: PW })).toEqual({ ok: true });

    expect((await requestPasswordReset(ctx.deps, { email: "me@example.invalid" })).ok).toBe(true);
    const code = codeFor(ctx.auth, "me@example.invalid");
    expect(await verifyResetCode(ctx.deps, { email: "me@example.invalid", code: `${code.slice(0, 3)}-${code.slice(3)}` })).toEqual({
      ok: true,
      data: undefined,
    });
    const update = vi.spyOn(ctx.auth, "updatePassword");
    expect(await setPassword(ctx.deps, { password: PW2, confirmPassword: PW2 })).toEqual({ ok: true, data: { redirectTo: "/" } });
    expect(update).toHaveBeenCalledWith(PW2, { signOutOthers: true });
    expect(await other.auth.getUser()).toBeNull();
    expect(await ctx.auth.getUser()).not.toBeNull();
    await ctx.auth.signOut();
    expect(await ctx.auth.signInWithPassword({ email: "me@example.invalid", password: PW })).toEqual({ ok: false, reason: "invalid_credentials" });
    expect(await ctx.auth.signInWithPassword({ email: "me@example.invalid", password: PW2 })).toEqual({ ok: true });
  });

  it("setPassword goes on to a safe next when given one", async () => {
    const ctx = await knownAccount();
    await recoverySession(ctx);
    expect(await setPassword(ctx.deps, { password: PW2, confirmPassword: PW2 }, "//evil.example")).toEqual({ ok: true, data: { redirectTo: "/" } });
  });

  it("a wrong reset code gets the one message and counts toward the same wrong-code lock", async () => {
    const ctx = await knownAccount();
    await requestPasswordReset(ctx.deps, { email: "me@example.invalid" });
    const code = codeFor(ctx.auth, "me@example.invalid");
    for (let i = 0; i < 5; i++) {
      expect(await verifyResetCode(ctx.deps, { email: "me@example.invalid", code: wrongCode(code) })).toEqual({
        ok: false,
        formError: AUTH_MESSAGES.codeInvalid,
      });
    }
    expect(await verifyResetCode(ctx.deps, { email: "me@example.invalid", code })).toMatchObject({ formError: AUTH_MESSAGES.tooManyCodes });
    expect(await verifySignUpCode(ctx.deps, { email: "me@example.invalid", code }, "/")).toMatchObject({ formError: AUTH_MESSAGES.tooManyCodes });
  });

  it("verifyResetCode refuses a malformed code or address before the provider", async () => {
    const ctx = setup();
    const verify = vi.spyOn(ctx.auth, "verifyCode");
    const r = await verifyResetCode(ctx.deps, { email: "nope", code: "12" });
    expect(!r.ok && Object.keys(r.fieldErrors ?? {}).sort()).toEqual(["code", "email"]);
    expect(verify).not.toHaveBeenCalled();
  });

  it("verifyResetCode reports a provider outage without blaming the code", async () => {
    const ctx = setup();
    vi.spyOn(ctx.auth, "verifyCode").mockRejectedValue(new AuthProviderError("unavailable"));
    expect(await verifyResetCode(ctx.deps, { email: "a@example.invalid", code: "123456" })).toEqual({
      ok: false,
      formError: AUTH_MESSAGES.codeCheckUnavailable,
    });
  });

  it("setPassword needs a session and a matching confirmation", async () => {
    const ctx = setup();
    const update = vi.spyOn(ctx.auth, "updatePassword");
    expect(await setPassword(ctx.deps, { password: PW2, confirmPassword: PW2 })).toEqual({ ok: false, formError: AUTH_MESSAGES.sessionEnded });
    const differ = await setPassword(ctx.deps, { password: PW2, confirmPassword: "something else" });
    expect(!differ.ok && differ.fieldErrors?.confirmPassword).toBe(AUTH_MESSAGES.passwordsDiffer);
    const short = await setPassword(ctx.deps, { password: "short", confirmPassword: "short" });
    expect(!short.ok && short.fieldErrors?.password).toBeTruthy();
    expect(update).not.toHaveBeenCalled();
  });

  it("from a password sign-in session the provider refuses; the password is unchanged and no success is claimed", async () => {
    const ctx = await knownAccount();
    await ctx.auth.signInWithPassword({ email: "me@example.invalid", password: PW });
    const result = await setPassword(ctx.deps, { password: PW2, confirmPassword: PW2 });
    expect(result).toEqual({ ok: false, formError: AUTH_MESSAGES.generic });
    await ctx.auth.signOut();
    expect(await ctx.auth.signInWithPassword({ email: "me@example.invalid", password: PW })).toEqual({ ok: true });
  });

  it("when the password changed but signing out other devices failed, it says so honestly", async () => {
    const ctx = await knownAccount();
    await recoverySession(ctx);
    const real = ctx.auth.updatePassword.bind(ctx.auth);
    vi.spyOn(ctx.auth, "updatePassword").mockImplementation(async (pw) => {
      await real(pw);
      throw new AuthProviderError("unavailable", "vendor");
    });
    const result = await setPassword(ctx.deps, { password: PW2, confirmPassword: PW2 });
    expect(result).toEqual({ ok: true, data: { redirectTo: "/", notice: AUTH_MESSAGES.otherDevicesMaybeSignedIn } });
    expect(await ctx.auth.getUser()).not.toBeNull();
  });

  it("maps weak_password to the password field and keeps the per-user hourly limit", async () => {
    const ctx = await knownAccount();
    await recoverySession(ctx);
    const update = vi.spyOn(ctx.auth, "updatePassword").mockRejectedValueOnce(new AuthProviderError("weak_password", "vendor"));
    const weak = await setPassword(ctx.deps, { password: PW2, confirmPassword: PW2 });
    expect(!weak.ok && weak.fieldErrors?.password).toBe(AUTH_MESSAGES.weakPassword);
    for (let i = 0; i < 9; i++) {
      expect((await setPassword(ctx.deps, { password: `new password ${i}`, confirmPassword: `new password ${i}` })).ok).toBe(true);
    }
    expect(await setPassword(ctx.deps, { password: "new password x", confirmPassword: "new password x" })).toMatchObject({
      ok: false,
      formError: AUTH_MESSAGES.tooMany,
    });
    expect(update).toHaveBeenCalledTimes(10);
  });
});

describe("repairGoogleAccount (spec 5.3)", () => {
  async function googleSignIn(auth: Ctx["auth"]) {
    const { url } = await auth.startGoogleSignIn({ redirectTo: `${SITE}/auth/callback` });
    expect(await auth.completeOAuth(new URL(url, SITE).searchParams.get("code")!)).toBe(true);
    return (await auth.getUser())!;
  }

  /** A stranger's pending email sign-up for the Google address, then the real person continues with Google. */
  async function strangerThenGoogle() {
    const store = createFakeAuthStore();
    const stranger = setup({ ip: "10.9.9.9" }, store);
    await signUpInBrowser(stranger, GOOGLE_EMAIL, STRANGER_PW, "Stranger Name");
    const g = setup({}, store);
    const user = await googleSignIn(g.auth);
    return { store, stranger, g, user };
  }

  it("removes a stranger's pending sign-up, kills its password, restores the session and takes the Google user's name and terms", async () => {
    const { stranger, g, user } = await strangerThenGoogle();
    const order: string[] = [];
    trace(order, g.directory, "hasPendingEmailIdentity");
    trace(order, g.auth, "updateDisplayName");
    trace(order, g.auth, "acceptTerms");
    trace(order, g.auth, "scramblePassword");
    trace(order, g.directory, "repairAfterGoogle");
    const open = trace(order, g.auth, "openSessionWithoutEmail");

    const result = await repairGoogleAccount(g.deps, user, "/groups/7");
    expect(result).toEqual({ ok: true, data: { redirectTo: "/groups/7" } });
    // Detect without deleting; name and terms while the Google session lives; remove the
    // identity only after the scramble, and before the minted session confirms (verifies) it.
    expect(order).toEqual([
      "hasPendingEmailIdentity",
      "updateDisplayName",
      "acceptTerms",
      "scramblePassword",
      "repairAfterGoogle",
      "openSessionWithoutEmail",
    ]);
    expect(open).toHaveBeenCalledWith({ email: GOOGLE_EMAIL, expectedUserId: user.id });

    expect(await stranger.auth.signInWithPassword({ email: GOOGLE_EMAIL, password: STRANGER_PW })).toEqual({
      ok: false,
      reason: "invalid_credentials",
    });
    const after = await g.auth.getUser();
    expect(after?.id).toBe(user.id);
    expect(after?.displayName).toBe("Google User");
    expect(after?.termsVersion).toBe(TERMS_VERSION);
    expect(await g.directory.describeEmail(GOOGLE_EMAIL)).toMatchObject({ kind: "confirmed", providers: ["google"] });
    // The minted session counts as a recovery request: the app's cooldown runs for the address.
    expect(await requestPasswordReset(g.deps, { email: GOOGLE_EMAIL })).toMatchObject({ formError: COOLDOWN_MESSAGE });
  });

  it("records the terms for a new Google user (empty version) and touches nothing else", async () => {
    const ctx = setup();
    const user = await googleSignIn(ctx.auth);
    expect(user.termsVersion).toBeNull();
    const scramble = vi.spyOn(ctx.auth, "scramblePassword");
    const accept = vi.spyOn(ctx.auth, "acceptTerms");
    expect(await repairGoogleAccount(ctx.deps, user)).toEqual({ ok: true, data: { redirectTo: "/" } });
    expect(accept).toHaveBeenCalledWith({ termsVersion: TERMS_VERSION });
    expect(scramble).not.toHaveBeenCalled();
    expect((await ctx.auth.getUser())?.termsVersion).toBe(TERMS_VERSION);
  });

  it("sends a user whose accepted version is out of date to /welcome without recording anything", async () => {
    const ctx = setup();
    await googleSignIn(ctx.auth);
    usersFor(ctx.store, GOOGLE_EMAIL)[0].termsVersion = "1999-01-01";
    const user = (await ctx.auth.getUser())!;
    const accept = vi.spyOn(ctx.auth, "acceptTerms");
    expect(await repairGoogleAccount(ctx.deps, user)).toEqual({ ok: true, data: { redirectTo: "/welcome" } });
    expect(await repairGoogleAccount(ctx.deps, user, "/groups/7")).toEqual({ ok: true, data: { redirectTo: "/welcome?next=%2Fgroups%2F7" } });
    expect(accept).not.toHaveBeenCalled();
  });

  it("leaves an existing confirmed password account alone (Google signs into it)", async () => {
    const ctx = setup();
    await confirmedAccount(ctx, GOOGLE_EMAIL, PW, "Owner Name");
    const user = await googleSignIn(ctx.auth);
    const scramble = vi.spyOn(ctx.auth, "scramblePassword");
    const rename = vi.spyOn(ctx.auth, "updateDisplayName");
    expect(await repairGoogleAccount(ctx.deps, user, "/x")).toEqual({ ok: true, data: { redirectTo: "/x" } });
    expect(scramble).not.toHaveBeenCalled();
    expect(rename).not.toHaveBeenCalled();
    expect(usersFor(ctx.store, GOOGLE_EMAIL)).toHaveLength(1);
    expect((await ctx.auth.getUser())?.displayName).toBe("Owner Name");
    await ctx.auth.signOut();
    expect(await ctx.auth.signInWithPassword({ email: GOOGLE_EMAIL, password: PW })).toEqual({ ok: true });
  });

  it.each(["hasPendingEmailIdentity", "repairAfterGoogle", "scramblePassword", "openSessionWithoutEmail", "updateDisplayName", "acceptTerms"] as const)(
    "a failure in %s signs the person out with the Google message",
    async (step) => {
      const { g, user } = await strangerThenGoogle();
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      if (step === "repairAfterGoogle" || step === "hasPendingEmailIdentity") {
        // A database error is a plain Error, not an AuthProviderError: it must be handled too.
        vi.spyOn(g.directory, step).mockRejectedValue(new Error(`db failed for ${GOOGLE_EMAIL}`));
      } else {
        vi.spyOn(g.auth, step).mockRejectedValue(new AuthProviderError("unavailable", "vendor"));
      }
      const result = await repairGoogleAccount(g.deps, user);
      expect(result).toEqual({ ok: false, formError: AUTH_MESSAGES.googleFailed });
      expect(await g.auth.getUser()).toBeNull();
      expect(JSON.stringify(warn.mock.calls)).not.toMatch(/example\.test|vendor/);
      warn.mockRestore();
    },
  );

  it("is retryable: after a failed scramble the signal stays, and the next Google sign-in still scrambles", async () => {
    const { store, stranger, g, user } = await strangerThenGoogle();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const scramble = vi.spyOn(g.auth, "scramblePassword").mockRejectedValue(new AuthProviderError("unavailable"));
    expect(await repairGoogleAccount(g.deps, user)).toEqual({ ok: false, formError: AUTH_MESSAGES.googleFailed });
    expect(scramble).toHaveBeenCalledTimes(2);
    expect(await g.auth.getUser()).toBeNull();
    expect(await g.directory.hasPendingEmailIdentity(user.id)).toBe(true);

    // The person tries again: a new Google sign-in, and this time the scramble works.
    scramble.mockRestore();
    const again = await googleSignIn(g.auth);
    const retryScramble = vi.spyOn(g.auth, "scramblePassword");
    expect(await repairGoogleAccount(g.deps, again)).toEqual({ ok: true, data: { redirectTo: "/" } });
    expect(retryScramble).toHaveBeenCalledWith(user.id);
    expect(await stranger.auth.signInWithPassword({ email: GOOGLE_EMAIL, password: STRANGER_PW })).toEqual({
      ok: false,
      reason: "invalid_credentials",
    });
    expect(await g.directory.hasPendingEmailIdentity(user.id)).toBe(false);
    expect(usersFor(store, GOOGLE_EMAIL)[0].displayName).toBe("Google User");
    warn.mockRestore();
  });

  it("a scramble that fails once is tried again within the same repair", async () => {
    const { stranger, g, user } = await strangerThenGoogle();
    const scramble = vi.spyOn(g.auth, "scramblePassword").mockRejectedValueOnce(new AuthProviderError("unavailable"));
    expect(await repairGoogleAccount(g.deps, user)).toEqual({ ok: true, data: { redirectTo: "/" } });
    expect(scramble).toHaveBeenCalledTimes(2);
    expect(await stranger.auth.signInWithPassword({ email: GOOGLE_EMAIL, password: STRANGER_PW })).toEqual({
      ok: false,
      reason: "invalid_credentials",
    });
  });

  it("a failure to record terms for a new Google user also signs out with the Google message", async () => {
    const ctx = setup();
    const user = await googleSignIn(ctx.auth);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(ctx.auth, "acceptTerms").mockRejectedValue(new AuthProviderError("unavailable"));
    expect(await repairGoogleAccount(ctx.deps, user)).toEqual({ ok: false, formError: AUTH_MESSAGES.googleFailed });
    expect(await ctx.auth.getUser()).toBeNull();
    warn.mockRestore();
  });
});
