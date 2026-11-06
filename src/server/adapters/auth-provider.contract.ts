import { describe, expect, test } from "vitest";
import type { AuthProvider } from "../ports/auth-provider";

/** What the contract needs to read from the test inbox. */
export type ContractOutbox = {
  readonly entries: readonly { to: string; kind: "confirm" | "reset"; url: string }[];
  lastFor(email: string): { to: string; kind: "confirm" | "reset"; url: string } | undefined;
};

/**
 * Behaviour every AuthProvider must have. `make` returns a fresh provider with
 * its own empty state, plus a view of the emails it sent (a test inbox).
 * Calling this registers tests, so call it only from a test file.
 */
export function runAuthProviderContract(make: () => { provider: AuthProvider; outbox: ContractOutbox }) {
  describe("AuthProvider contract", () => {
    const REDIRECT = "http://localhost:3000/after";
    const PASSWORD = "correct horse";
    const sign = (email = "ada@example.com", password = PASSWORD) => ({
      email,
      password,
      displayName: "Ada",
      termsVersion: "2026-11",
      redirectTo: REDIRECT,
    });
    const tokenOf = (url: string) => new URL(url, "http://localhost").searchParams.get("token_hash") ?? "";

    async function confirmed(email = "ada@example.com") {
      const ctx = make();
      await ctx.provider.signUpWithPassword(sign(email));
      const link = ctx.outbox.lastFor(email)!;
      expect(await ctx.provider.confirmEmailToken({ tokenHash: tokenOf(link.url), type: "email" })).toBe(true);
      await ctx.provider.signOut();
      return ctx;
    }

    test("sign-in fails with email_not_confirmed until the emailed link is used", async () => {
      const { provider, outbox } = make();
      await provider.signUpWithPassword(sign());
      expect(await provider.signInWithPassword({ email: "ada@example.com", password: PASSWORD })).toEqual({
        ok: false,
        reason: "email_not_confirmed",
      });
      const link = outbox.lastFor("ada@example.com")!;
      expect(link.kind).toBe("confirm");
      expect(await provider.confirmEmailToken({ tokenHash: tokenOf(link.url), type: "email" })).toBe(true);
      await provider.signOut();
      expect(await provider.signInWithPassword({ email: "ada@example.com", password: PASSWORD })).toEqual({ ok: true });
    });

    test("the emailed link carries the redirect and a token", async () => {
      const { provider, outbox } = make();
      await provider.signUpWithPassword(sign());
      const url = new URL(outbox.lastFor("ada@example.com")!.url, "http://localhost");
      expect(url.pathname).toBe("/auth/confirm");
      expect(url.searchParams.get("type")).toBe("email");
      expect(url.searchParams.get("redirect_to")).toBe(REDIRECT);
      expect(url.searchParams.get("token_hash")).toBeTruthy();
    });

    // Real Supabase does this (checked live with npm run check:auth-behaviour): a repeat sign-up
    // of an unconfirmed address keeps the FIRST password. /auth/confirm therefore signs out after
    // a sign-up confirmation (src/server/auth/email-link.ts).
    test("signing up twice before confirming looks the same and keeps the FIRST password", async () => {
      const { provider, outbox } = make();
      await expect(provider.signUpWithPassword(sign())).resolves.toBeUndefined();
      const afterFirst = outbox.entries.length;
      await expect(provider.signUpWithPassword(sign("ada@example.com", "another password"))).resolves.toBeUndefined();
      expect(outbox.entries.length - afterFirst).toBe(afterFirst);
      const link = outbox.lastFor("ada@example.com")!;
      expect(await provider.confirmEmailToken({ tokenHash: tokenOf(link.url), type: "email" })).toBe(true);
      await provider.signOut();
      expect(await provider.signInWithPassword({ email: "ada@example.com", password: "another password" })).toEqual({
        ok: false,
        reason: "invalid_credentials",
      });
      expect(await provider.signInWithPassword({ email: "ada@example.com", password: PASSWORD })).toEqual({ ok: true });
    });

    test("signing up again with a confirmed email does not throw or replace the password", async () => {
      const { provider } = await confirmed();
      await expect(provider.signUpWithPassword(sign("ada@example.com", "another password"))).resolves.toBeUndefined();
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

    test("an unknown or already used token returns false", async () => {
      const { provider, outbox } = make();
      expect(await provider.confirmEmailToken({ tokenHash: "no-such-token", type: "email" })).toBe(false);
      await provider.signUpWithPassword(sign());
      const token = tokenOf(outbox.lastFor("ada@example.com")!.url);
      expect(await provider.confirmEmailToken({ tokenHash: token, type: "email" })).toBe(true);
      expect(await provider.confirmEmailToken({ tokenHash: token, type: "email" })).toBe(false);
    });

    test("resendConfirmation sends a fresh link to an unconfirmed address and nothing for an unknown one", async () => {
      const { provider, outbox } = make();
      await provider.signUpWithPassword(sign());
      const before = outbox.entries.length;
      await provider.resendConfirmation({ email: "ada@example.com", redirectTo: REDIRECT });
      expect(outbox.entries.length).toBe(before + 1);
      await expect(
        provider.resendConfirmation({ email: "nobody@example.com", redirectTo: REDIRECT }),
      ).resolves.toBeUndefined();
      expect(outbox.entries.length).toBe(before + 1);
      const token = tokenOf(outbox.lastFor("ada@example.com")!.url);
      expect(await provider.confirmEmailToken({ tokenHash: token, type: "email" })).toBe(true);
    });

    test("resendConfirmation for an already-confirmed address does not throw and sends nothing", async () => {
      // Real Supabase returns normally here too (checked live with npm run check:auth-behaviour),
      // so the reply for a confirmed address looks the same as for an unknown one.
      const { provider, outbox } = await confirmed();
      const before = outbox.entries.length;
      await expect(provider.resendConfirmation({ email: "ada@example.com", redirectTo: REDIRECT })).resolves.toBeUndefined();
      expect(outbox.entries.length).toBe(before);
    });

    test("sendPasswordReset for an unknown email does not throw and sends nothing", async () => {
      const { provider, outbox } = make();
      await expect(
        provider.sendPasswordReset({ email: "nobody@example.com", redirectTo: REDIRECT }),
      ).resolves.toBeUndefined();
      expect(outbox.entries).toHaveLength(0);
    });

    test("a recovery token allows updatePassword; the old password then fails and the new one works", async () => {
      const { provider, outbox } = await confirmed();
      await provider.sendPasswordReset({ email: "ada@example.com", redirectTo: REDIRECT });
      const link = outbox.lastFor("ada@example.com")!;
      expect(link.kind).toBe("reset");
      expect(new URL(link.url, "http://localhost").searchParams.get("type")).toBe("recovery");
      expect(await provider.confirmEmailToken({ tokenHash: tokenOf(link.url), type: "recovery" })).toBe(true);
      await provider.updatePassword("a brand new password");
      await provider.signOut();
      expect(await provider.signInWithPassword({ email: "ada@example.com", password: PASSWORD })).toEqual({
        ok: false,
        reason: "invalid_credentials",
      });
      expect(await provider.signInWithPassword({ email: "ada@example.com", password: "a brand new password" })).toEqual({
        ok: true,
      });
    });

    test("a token of one type is refused as the other type", async () => {
      const { provider, outbox } = make();
      await provider.signUpWithPassword(sign());
      const token = tokenOf(outbox.lastFor("ada@example.com")!.url);
      expect(await provider.confirmEmailToken({ tokenHash: token, type: "recovery" })).toBe(false);
    });

    test("updatePassword rejects a password under 8 characters with weak_password", async () => {
      const { provider } = await confirmed();
      await provider.signInWithPassword({ email: "ada@example.com", password: PASSWORD });
      await expect(provider.updatePassword("short")).rejects.toMatchObject({ code: "weak_password" });
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
