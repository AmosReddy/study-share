import { describe, expect, test } from "vitest";
import { CODE_LENGTH } from "@/shared/auth-schemas";
import type { AuthProvider, CodeKind } from "../ports/auth-provider";

export type ContractCodeEmail = { to: string; kind: "code"; purpose: CodeKind; code: string };

/** What the contract needs to read from the test inbox. */
export type ContractOutbox = {
  readonly entries: readonly ContractCodeEmail[];
  /** The newest CODE email to an address. */
  lastCodeFor(email: string): ContractCodeEmail | undefined;
};

export type ContractContext = {
  provider: AuthProvider;
  outbox: ContractOutbox;
  /** Another browser on the same accounts: its own session, the same users. */
  otherDevice(): AuthProvider;
  /** Makes every code issued so far expire, as if ten minutes had passed. */
  expireAllCodes(): void;
  /** Turns on the provider's per-address email interval (the real provider always has it). */
  enforceEmailInterval(): void;
};

/**
 * Behaviour every AuthProvider must have. `make` returns a fresh provider with
 * its own empty state, plus a view of the emails it sent (a test inbox).
 * Calling this registers tests, so call it only from a test file.
 */
export function runAuthProviderContract(make: () => ContractContext) {
  runCodeContract(make);
  runSharedContract(make);
}

/** A code of the right shape that is not `code`. */
function otherCode(code: string) {
  return code
    .split("")
    .map((d) => String((Number(d) + 1) % 10))
    .join("");
}

function runCodeContract(make: () => ContractContext) {
  describe("AuthProvider contract: email codes", () => {
    const PASSWORD = "correct horse";
    const EMAIL = "ada@example.com";
    const sign = (email = EMAIL, password = PASSWORD) => ({ email, password, displayName: "Ada", termsVersion: "2026-11" });
    const INVALID = { ok: false, reason: "invalid_or_expired" } as const;

    function codeFor(ctx: ContractContext, email: string, purpose: CodeKind) {
      const sent = ctx.outbox.lastCodeFor(email);
      expect(sent?.purpose).toBe(purpose);
      return sent!.code;
    }

    /** A confirmed, signed-out account. */
    async function confirmed(email = EMAIL) {
      const ctx = make();
      const { userId } = await ctx.provider.signUpWithPassword(sign(email));
      expect(await ctx.provider.verifyCode({ email, code: codeFor(ctx, email, "signup"), kind: "signup" })).toEqual({
        ok: true,
        userId,
      });
      await ctx.provider.signOut();
      return { ...ctx, userId };
    }

    test("sign-up emails a code of CODE_LENGTH digits; the code confirms the address and signs in", async () => {
      const ctx = make();
      const { provider } = ctx;
      const { userId } = await provider.signUpWithPassword(sign());
      expect(userId).toBeTruthy();
      const code = codeFor(ctx, EMAIL, "signup");
      expect(code).toMatch(new RegExp(`^\\d{${CODE_LENGTH}}$`));
      expect(await provider.signInWithPassword({ email: EMAIL, password: PASSWORD })).toEqual({
        ok: false,
        reason: "email_not_confirmed",
      });

      expect(await provider.verifyCode({ email: EMAIL, code, kind: "signup" })).toEqual({ ok: true, userId });
      expect((await provider.getUser())?.id).toBe(userId);
      await provider.signOut();
      expect(await provider.signInWithPassword({ email: EMAIL, password: PASSWORD })).toEqual({ ok: true });
    });

    test("an unconfirmed account answers email_not_confirmed only for the right password", async () => {
      const { provider } = make();
      await provider.signUpWithPassword(sign());
      expect(await provider.signInWithPassword({ email: EMAIL, password: PASSWORD })).toEqual({
        ok: false,
        reason: "email_not_confirmed",
      });
      expect(await provider.signInWithPassword({ email: EMAIL, password: "wrong password" })).toEqual({
        ok: false,
        reason: "invalid_credentials",
      });
    });

    test("a wrong code gives invalid_or_expired and signs nobody in", async () => {
      const ctx = make();
      await ctx.provider.signUpWithPassword(sign());
      const code = codeFor(ctx, EMAIL, "signup");
      expect(await ctx.provider.verifyCode({ email: EMAIL, code: otherCode(code), kind: "signup" })).toEqual(INVALID);
      expect(await ctx.provider.getUser()).toBeNull();
    });

    test("a code for an unknown address, or of the other kind, gives invalid_or_expired", async () => {
      const ctx = make();
      await ctx.provider.signUpWithPassword(sign());
      const code = codeFor(ctx, EMAIL, "signup");
      expect(await ctx.provider.verifyCode({ email: "nobody@example.com", code, kind: "signup" })).toEqual(INVALID);
      expect(await ctx.provider.verifyCode({ email: EMAIL, code, kind: "recovery" })).toEqual(INVALID);
      expect(await ctx.provider.getUser()).toBeNull();
    });

    test("a code works once: using it again gives invalid_or_expired", async () => {
      const ctx = make();
      await ctx.provider.signUpWithPassword(sign());
      const code = codeFor(ctx, EMAIL, "signup");
      expect((await ctx.provider.verifyCode({ email: EMAIL, code, kind: "signup" })).ok).toBe(true);
      await ctx.provider.signOut();
      expect(await ctx.provider.verifyCode({ email: EMAIL, code, kind: "signup" })).toEqual(INVALID);
      expect(await ctx.provider.getUser()).toBeNull();
    });

    test("a resend supersedes the earlier code: only the newest works", async () => {
      const ctx = make();
      const { userId } = await ctx.provider.signUpWithPassword(sign());
      const first = codeFor(ctx, EMAIL, "signup");
      await ctx.provider.resendSignUpCode({ email: EMAIL });
      const second = codeFor(ctx, EMAIL, "signup");
      if (first !== second) {
        expect(await ctx.provider.verifyCode({ email: EMAIL, code: first, kind: "signup" })).toEqual(INVALID);
      }
      expect(await ctx.provider.verifyCode({ email: EMAIL, code: second, kind: "signup" })).toEqual({ ok: true, userId });
    });

    test("an expired code gives invalid_or_expired, and a resend gives a code that works", async () => {
      const ctx = make();
      const { userId } = await ctx.provider.signUpWithPassword(sign());
      const code = codeFor(ctx, EMAIL, "signup");
      ctx.expireAllCodes();
      expect(await ctx.provider.verifyCode({ email: EMAIL, code, kind: "signup" })).toEqual(INVALID);
      await ctx.provider.resendSignUpCode({ email: EMAIL });
      expect(await ctx.provider.verifyCode({ email: EMAIL, code: codeFor(ctx, EMAIL, "signup"), kind: "signup" })).toEqual({
        ok: true,
        userId,
      });
    });

    // GoTrue does this (Task 1 probe): a repeat sign-up of an UNCONFIRMED address returns the same
    // user, emails a new code (the old one stops working) and keeps the FIRST password. The
    // sign-up use-case defends against it (design 5.1).
    test("signing up twice before confirming returns the same id, supersedes the code and keeps the FIRST password", async () => {
      const ctx = make();
      const { provider } = ctx;
      const first = await provider.signUpWithPassword(sign());
      const firstCode = codeFor(ctx, EMAIL, "signup");
      const second = await provider.signUpWithPassword(sign(EMAIL, "another password"));
      expect(second.userId).toBe(first.userId);
      const secondCode = codeFor(ctx, EMAIL, "signup");
      if (firstCode !== secondCode) {
        expect(await provider.verifyCode({ email: EMAIL, code: firstCode, kind: "signup" })).toEqual(INVALID);
      }
      expect(await provider.signInWithPassword({ email: EMAIL, password: "another password" })).toEqual({
        ok: false,
        reason: "invalid_credentials",
      });
      expect(await provider.verifyCode({ email: EMAIL, code: secondCode, kind: "signup" })).toEqual({
        ok: true,
        userId: first.userId,
      });
      await provider.signOut();
      expect(await provider.signInWithPassword({ email: EMAIL, password: PASSWORD })).toEqual({ ok: true });
    });

    test("signing up with a confirmed address sends nothing and keeps the password", async () => {
      const ctx = await confirmed();
      const before = ctx.outbox.entries.length;
      await expect(ctx.provider.signUpWithPassword(sign(EMAIL, "another password"))).resolves.toEqual({
        userId: expect.any(String),
      });
      expect(ctx.outbox.entries.length).toBe(before);
      expect(await ctx.provider.signInWithPassword({ email: EMAIL, password: "another password" })).toEqual({
        ok: false,
        reason: "invalid_credentials",
      });
      expect(await ctx.provider.signInWithPassword({ email: EMAIL, password: PASSWORD })).toEqual({ ok: true });
    });

    test("resendSignUpCode is neutral: it resolves and sends nothing for a confirmed or unknown address", async () => {
      const ctx = await confirmed();
      const before = ctx.outbox.entries.length;
      await expect(ctx.provider.resendSignUpCode({ email: EMAIL })).resolves.toBeUndefined();
      await expect(ctx.provider.resendSignUpCode({ email: "nobody@example.com" })).resolves.toBeUndefined();
      expect(ctx.outbox.entries.length).toBe(before);
    });

    test("sendPasswordResetCode is neutral: it resolves for an unknown address and sends nothing", async () => {
      const ctx = make();
      await expect(ctx.provider.sendPasswordResetCode({ email: "nobody@example.com" })).resolves.toBeUndefined();
      expect(ctx.outbox.entries).toHaveLength(0);
    });

    test("a recovery code signs in; updatePassword then sets a new password and the old one stops working", async () => {
      const ctx = await confirmed();
      const { provider, userId } = ctx;
      await expect(provider.sendPasswordResetCode({ email: EMAIL })).resolves.toBeUndefined();
      const code = codeFor(ctx, EMAIL, "recovery");
      expect(code).toMatch(new RegExp(`^\\d{${CODE_LENGTH}}$`));
      expect(await provider.verifyCode({ email: EMAIL, code, kind: "signup" })).toEqual(INVALID);
      expect(await provider.verifyCode({ email: EMAIL, code, kind: "recovery" })).toEqual({ ok: true, userId });
      expect((await provider.getUser())?.id).toBe(userId);
      await provider.updatePassword("a brand new password");
      await provider.signOut();
      expect(await provider.signInWithPassword({ email: EMAIL, password: PASSWORD })).toEqual({
        ok: false,
        reason: "invalid_credentials",
      });
      expect(await provider.signInWithPassword({ email: EMAIL, password: "a brand new password" })).toEqual({ ok: true });
    });

    /** Signs `provider` in with a recovery code: a code session, the kind that may change the password. */
    async function signInByRecoveryCode(ctx: ContractContext, provider: AuthProvider, email = EMAIL) {
      await provider.sendPasswordResetCode({ email });
      expect((await provider.verifyCode({ email, code: codeFor(ctx, email, "recovery"), kind: "recovery" })).ok).toBe(true);
    }

    test("updatePassword rejects a password under 8 characters with weak_password", async () => {
      const ctx = await confirmed();
      await signInByRecoveryCode(ctx, ctx.provider);
      await expect(ctx.provider.updatePassword("short")).rejects.toMatchObject({ code: "weak_password" });
    });

    // Probe (l): GoTrue answers 400 current_password_required to a password change from a
    // password sign-in session, and nothing changes. Password changes happen after a code.
    test("a password sign-in session cannot change the password: refused as unavailable, nothing changes", async () => {
      const ctx = await confirmed();
      const there = ctx.otherDevice();
      await ctx.provider.signInWithPassword({ email: EMAIL, password: PASSWORD });
      await there.signInWithPassword({ email: EMAIL, password: PASSWORD });
      await expect(ctx.provider.updatePassword("a brand new password")).rejects.toMatchObject({ code: "unavailable" });
      expect((await ctx.provider.getUser())?.id).toBe(ctx.userId);
      expect((await there.getUser())?.id).toBe(ctx.userId);
      expect(await ctx.otherDevice().signInWithPassword({ email: EMAIL, password: PASSWORD })).toEqual({ ok: true });
    });

    test("updatePassword with signOutOthers keeps this session and ends the one on another device", async () => {
      const ctx = await confirmed();
      const here = ctx.provider;
      const there = ctx.otherDevice();
      expect(await there.signInWithPassword({ email: EMAIL, password: PASSWORD })).toEqual({ ok: true });
      await signInByRecoveryCode(ctx, here);

      await here.updatePassword("a brand new password", { signOutOthers: true });
      expect((await here.getUser())?.id).toBe(ctx.userId);
      expect(await there.getUser()).toBeNull();
    });

    // Probes (l2) and (m): a password change from a code session ends the user's other sessions
    // even without signOut(others), and a recovery code issued before it stops working.
    test("a password change ends other sessions even without signOutOthers, and outstanding codes stop working", async () => {
      const ctx = await confirmed();
      const there = ctx.otherDevice();
      await there.signInWithPassword({ email: EMAIL, password: PASSWORD });
      await signInByRecoveryCode(ctx, ctx.provider);
      await ctx.provider.sendPasswordResetCode({ email: EMAIL });
      const outstanding = codeFor(ctx, EMAIL, "recovery");

      await ctx.provider.updatePassword("a brand new password");
      expect((await ctx.provider.getUser())?.id).toBe(ctx.userId);
      expect(await there.getUser()).toBeNull();
      expect(await ctx.otherDevice().verifyCode({ email: EMAIL, code: outstanding, kind: "recovery" })).toEqual(INVALID);
    });

    // Probe (k): an admin password update ends EVERY session of the user, the caller's too, and
    // (m) outstanding codes. So "verify a code, scramble, then updatePassword in the same
    // session" does not work: the session is gone. A new code gives a new session.
    test("the design path: verify a code, then scramblePassword, ends that session; only a new code lets a password be set", async () => {
      const ctx = make();
      const { provider } = ctx;
      const { userId } = await provider.signUpWithPassword(sign());
      expect((await provider.verifyCode({ email: EMAIL, code: codeFor(ctx, EMAIL, "signup"), kind: "signup" })).ok).toBe(true);
      const there = ctx.otherDevice();
      await there.signInWithPassword({ email: EMAIL, password: PASSWORD });
      await provider.sendPasswordResetCode({ email: EMAIL });
      const outstanding = codeFor(ctx, EMAIL, "recovery");
      const before = ctx.outbox.entries.length;

      await expect(provider.scramblePassword(userId)).resolves.toBeUndefined();
      expect(ctx.outbox.entries.length).toBe(before);
      expect(await provider.getUser()).toBeNull();
      expect(await there.getUser()).toBeNull();
      await expect(provider.updatePassword("a chosen password")).rejects.toMatchObject({ code: "unavailable" });
      expect(await provider.verifyCode({ email: EMAIL, code: outstanding, kind: "recovery" })).toEqual(INVALID);
      expect(await ctx.otherDevice().signInWithPassword({ email: EMAIL, password: PASSWORD })).toEqual({
        ok: false,
        reason: "invalid_credentials",
      });

      // A recovery code sent afterwards gives a code session that can set the password.
      await signInByRecoveryCode(ctx, provider);
      await provider.updatePassword("a chosen password");
      await provider.signOut();
      expect(await provider.signInWithPassword({ email: EMAIL, password: "a chosen password" })).toEqual({ ok: true });
    });

    // Ruling P9, probe (p): the chosen design-5.1 order. The scramble kills every session; the
    // server then opens a fresh one without email, from which the person sets a password.
    test("the chosen order: verify, scramble, openSessionWithoutEmail, then updatePassword sets the password", async () => {
      const ctx = make();
      const { provider } = ctx;
      const { userId } = await provider.signUpWithPassword(sign());
      expect((await provider.verifyCode({ email: EMAIL, code: codeFor(ctx, EMAIL, "signup"), kind: "signup" })).ok).toBe(true);
      const there = ctx.otherDevice();
      await there.signInWithPassword({ email: EMAIL, password: PASSWORD });
      await provider.scramblePassword(userId);
      expect(await provider.getUser()).toBeNull();
      const before = ctx.outbox.entries.length;

      await expect(provider.openSessionWithoutEmail({ email: EMAIL, expectedUserId: userId })).resolves.toEqual({ userId });
      expect(ctx.outbox.entries.length).toBe(before);
      expect((await provider.getUser())?.id).toBe(userId);
      // Only this browser gets the session; the stranger's device stays out.
      expect(await there.getUser()).toBeNull();

      await provider.updatePassword("a chosen password");
      await provider.signOut();
      expect(await provider.signInWithPassword({ email: EMAIL, password: PASSWORD })).toEqual({
        ok: false,
        reason: "invalid_credentials",
      });
      expect(await provider.signInWithPassword({ email: EMAIL, password: "a chosen password" })).toEqual({ ok: true });
    });

    // Probe (q): the same works for an account that never had a password (the Google repair).
    test("openSessionWithoutEmail restores a session for an account that never had a password, after a scramble", async () => {
      const ctx = make();
      const { provider } = ctx;
      const { url } = await provider.startGoogleSignIn({ redirectTo: "http://localhost:3000/auth/callback" });
      expect(await provider.completeOAuth(new URL(url, "http://localhost").searchParams.get("code")!)).toBe(true);
      const user = (await provider.getUser())!;
      await provider.scramblePassword(user.id);
      expect(await provider.getUser()).toBeNull();

      await expect(provider.openSessionWithoutEmail({ email: user.email, expectedUserId: user.id })).resolves.toEqual({
        userId: user.id,
      });
      expect((await provider.getUser())?.id).toBe(user.id);
      await provider.updatePassword("an added password");
      await provider.signOut();
      expect(await provider.signInWithPassword({ email: user.email, password: "an added password" })).toEqual({ ok: true });
    });

    test("openSessionWithoutEmail for an unknown address is unavailable and opens nothing", async () => {
      const ctx = make();
      await expect(
        ctx.provider.openSessionWithoutEmail({ email: "nobody@example.com", expectedUserId: crypto.randomUUID() }),
      ).rejects.toMatchObject({ code: "unavailable" });
      expect(await ctx.provider.getUser()).toBeNull();
      expect(ctx.outbox.entries).toHaveLength(0);
    });

    // Misuse hardening (ruling P11): the session is opened only for the user the caller proved.
    test("openSessionWithoutEmail for an address whose account is not the expected user is unavailable and leaves no session", async () => {
      const ctx = make();
      const { userId } = await ctx.provider.signUpWithPassword(sign());
      const otherId = crypto.randomUUID();
      const error = (await ctx.provider
        .openSessionWithoutEmail({ email: EMAIL, expectedUserId: otherId })
        .catch((e: unknown) => e)) as Error & { code?: string };
      expect(error.code).toBe("unavailable");
      expect(`${error.message} ${error.stack}`).not.toContain(userId);
      expect(`${error.message} ${error.stack}`).not.toContain(otherId);
      expect(await ctx.provider.getUser()).toBeNull();
    });

    // Probe (n): a second sign-up, resend or recovery email to one address within seconds gets
    // 429 over_email_send_rate_limit, which is rate_limited here.
    test("with the per-address email interval on, a second email within the interval is rate_limited", async () => {
      const ctx = make();
      ctx.enforceEmailInterval();
      const { provider } = ctx;
      await provider.signUpWithPassword(sign());
      await expect(provider.signUpWithPassword(sign())).rejects.toMatchObject({ code: "rate_limited" });
      await expect(provider.resendSignUpCode({ email: EMAIL })).rejects.toMatchObject({ code: "rate_limited" });
      // Another address is not affected.
      await expect(provider.signUpWithPassword(sign("bo@example.com"))).resolves.toEqual({ userId: expect.any(String) });

      const reset = await confirmed("cy@example.com");
      reset.enforceEmailInterval();
      await reset.provider.sendPasswordResetCode({ email: "cy@example.com" });
      await expect(reset.provider.sendPasswordResetCode({ email: "cy@example.com" })).rejects.toMatchObject({
        code: "rate_limited",
      });
    });

    test("scramblePassword works on an unconfirmed sign-up too, so a stranger's password never survives", async () => {
      const ctx = make();
      const { userId } = await ctx.provider.signUpWithPassword(sign());
      await ctx.provider.scramblePassword(userId);
      expect(await ctx.provider.signInWithPassword({ email: EMAIL, password: PASSWORD })).toEqual({
        ok: false,
        reason: "invalid_credentials",
      });
    });
  });
}

/** Behaviour shared by every sign-in path (accounts confirmed by an emailed code). */
function runSharedContract(make: () => ContractContext) {
  describe("AuthProvider contract: shared behaviour", () => {
    const REDIRECT = "http://localhost:3000/after";
    const PASSWORD = "correct horse";
    const sign = (email = "ada@example.com", password = PASSWORD) => ({
      email,
      password,
      displayName: "Ada",
      termsVersion: "2026-11",
    });

    async function confirmed(email = "ada@example.com") {
      const ctx = make();
      await ctx.provider.signUpWithPassword(sign(email));
      const code = ctx.outbox.lastCodeFor(email)!.code;
      expect(await ctx.provider.verifyCode({ email, code, kind: "signup" })).toMatchObject({ ok: true });
      await ctx.provider.signOut();
      return ctx;
    }

    test("signing up again with a confirmed email does not throw or replace the password", async () => {
      const { provider } = await confirmed();
      await expect(provider.signUpWithPassword(sign("ada@example.com", "another password"))).resolves.toEqual({
        userId: expect.any(String),
      });
      expect(await provider.signInWithPassword({ email: "ada@example.com", password: "another password" })).toEqual({
        ok: false,
        reason: "invalid_credentials",
      });
      expect(await provider.signInWithPassword({ email: "ada@example.com", password: PASSWORD })).toEqual({ ok: true });
    });

    test("a wrong password gives invalid_credentials for known and unknown emails alike", async () => {
      const { provider } = await confirmed();
      const known = await provider.signInWithPassword({ email: "ada@example.com", password: "wrong password" });
      const unknown = await provider.signInWithPassword({ email: "nobody@example.com", password: "wrong password" });
      expect(known).toEqual({ ok: false, reason: "invalid_credentials" });
      expect(unknown).toEqual(known);
    });

    test("an unconfirmed account with the wrong password does not reveal that it exists", async () => {
      const { provider } = make();
      await provider.signUpWithPassword(sign());
      expect(await provider.signInWithPassword({ email: "ada@example.com", password: "wrong password" })).toEqual({
        ok: false,
        reason: "invalid_credentials",
      });
    });

    test("getUser is null before sign-in, then returns the name and terms version", async () => {
      const { provider } = await confirmed();
      expect(await provider.getUser()).toBeNull();
      await provider.signInWithPassword({ email: "ada@example.com", password: PASSWORD });
      expect(await provider.getUser()).toMatchObject({
        email: "ada@example.com",
        displayName: "Ada",
        termsVersion: "2026-11",
      });
    });

    test("acceptTerms sets the terms version", async () => {
      const { provider } = await confirmed();
      await provider.signInWithPassword({ email: "ada@example.com", password: PASSWORD });
      await provider.acceptTerms({ termsVersion: "2027-01" });
      expect((await provider.getUser())?.termsVersion).toBe("2027-01");
    });

    test("clearTermsAcceptance empties the terms version, so the terms must be accepted again", async () => {
      const { provider } = await confirmed();
      await provider.signInWithPassword({ email: "ada@example.com", password: PASSWORD });
      await provider.clearTermsAcceptance();
      expect((await provider.getUser())?.termsVersion).toBeNull();
    });

    test("updateDisplayName changes the name", async () => {
      const { provider } = await confirmed();
      await provider.signInWithPassword({ email: "ada@example.com", password: PASSWORD });
      await provider.updateDisplayName("Ada L.");
      expect((await provider.getUser())?.displayName).toBe("Ada L.");
    });

    test("signOut clears the user", async () => {
      const { provider } = await confirmed();
      await provider.signInWithPassword({ email: "ada@example.com", password: PASSWORD });
      await provider.signOut();
      expect(await provider.getUser()).toBeNull();
    });

    test("Google sign-in returns a URL, and completing it with its code creates a confirmed user", async () => {
      const { provider } = make();
      const { url } = await provider.startGoogleSignIn({ redirectTo: REDIRECT });
      const code = new URL(url, "http://localhost").searchParams.get("code");
      expect(code).toBeTruthy();
      expect(await provider.getUser()).toBeNull();
      expect(await provider.completeOAuth(code!)).toBe(true);
      expect(await provider.getUser()).not.toBeNull();
      expect(await provider.completeOAuth(code!)).toBe(false);
      expect(await provider.completeOAuth("unknown-code")).toBe(false);
    });
  });
}
