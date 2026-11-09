import { CODE_LENGTH } from "@/shared/auth-schemas";
import { AuthProviderError, type AuthProvider, type AuthUser, type CodeKind, type VerifyCodeResult } from "../ports/auth-provider";

/*
  Test-mode sign-in. No vendor library and no network. Passwords are kept as
  plain text in memory because this fake only runs in test mode; they are never
  logged or put in an error. Emails are "sent" to an in-memory outbox so tests
  can read the codes.

  It mirrors the GoTrue behaviours the use-cases rely on (checked live, Task 1):
  a repeat sign-up of an unconfirmed address keeps the FIRST password and the same
  user id; an unconfirmed user's sign-in answers email_not_confirmed only for the
  right password; a newer code (resend or repeat sign-up) supersedes the earlier one;
  every bad code gets the one failure reason; signOut-others ends the user's other
  sessions but not this one.
*/

/** A code email, as the real templates send: the code only. */
export type FakeCodeEntry = { to: string; kind: "code"; purpose: CodeKind; code: string };
export type FakeOutboxEntry = FakeCodeEntry;

export class FakeOutbox {
  readonly entries: FakeOutboxEntry[] = [];

  add(entry: FakeOutboxEntry) {
    this.entries.push(entry);
  }

  /** The newest email to an address. */
  latestFor(email: string): FakeOutboxEntry | undefined {
    const to = normaliseEmail(email);
    for (let i = this.entries.length - 1; i >= 0; i--) {
      if (this.entries[i].to === to) return this.entries[i];
    }
    return undefined;
  }

  /** The newest code email to an address (every email is a code email now). */
  lastCodeFor(email: string): FakeCodeEntry | undefined {
    return this.latestFor(email);
  }
}

export type FakeIdentity = { provider: "email" | "google"; verified: boolean };

export type FakeUser = {
  id: string;
  email: string;
  /** null (or "") when no password was ever set, as for a Google-only account. */
  password: string | null;
  displayName: string;
  /** The name Google supplied (set by the fake Google sign-in), kept apart from the typed displayName. */
  providerName?: string;
  termsVersion: string | null;
  confirmed: boolean;
  identities: FakeIdentity[];
};

type FakeCode = { userId: string; kind: CodeKind; code: string; expired: boolean };

/** How a session was made. GoTrue refuses a password change from a password sign-in session (probe l). */
export type FakeSession = { userId: string; via: "password" | "code" | "oauth" };

/** GoTrue's per-address interval between two emails of one kind (probe n: a second within 3 s gets 429). */
export const EMAIL_INTERVAL_MS = 60_000;

export type FakeAuthStore = {
  users: Map<string, FakeUser>;
  /** Session id (the cookie value) to its session. */
  sessions: Map<string, FakeSession>;
  /**
   * Test switch, off by default so existing browser tests are unaffected: when on, a second
   * sign-up/resend email (or a second recovery email) to one address within EMAIL_INTERVAL_MS
   * is refused with rate_limited, as GoTrue does.
   */
  enforceEmailInterval: boolean;
  /** When each account was last sent each kind of email, keyed `${userId}:${kind}`. */
  lastEmailAt: Map<string, number>;
  /** The one live code per user and kind, keyed `${userId}:${kind}`. A newer code replaces it. */
  codes: Map<string, FakeCode>;
  /** Single-use codes handed out by startGoogleSignIn. */
  oauthCodes: Set<string>;
  outbox: FakeOutbox;
  /** Test mode only: the next signOut throws once, so browser tests can see a failed log-out. */
  failNextSignOut: boolean;
  /**
   * Test mode only: the next Google repair check (the fake directory's hasPendingEmailIdentity)
   * throws once, so browser tests can see a failed Google repair. POST /api/test/reset clears it.
   */
  failNextRepair: boolean;
  /** The terms fields of each user's profile row, as the fake ProfileStore records them. */
  profileTerms: Map<string, FakeProfileTerms>;
};

/** The terms fields of a profile row (public.profiles), for the fake ProfileStore. */
export type FakeProfileTerms = { termsVersion: string | null; termsAcceptedAt: Date | null; ageConfirmedAt: Date | null };

export type FakeCookies = {
  get(name: string): string | undefined;
  set(name: string, value: string): void;
  delete(name: string): void;
};

export function createFakeAuthStore(): FakeAuthStore {
  return {
    users: new Map(),
    sessions: new Map(),
    enforceEmailInterval: false,
    lastEmailAt: new Map(),
    codes: new Map(),
    oauthCodes: new Set(),
    outbox: new FakeOutbox(),
    failNextSignOut: false,
    failNextRepair: false,
    profileTerms: new Map(),
  };
}

const STORE_KEY = "__studyShareFakeAuthStore";

/**
 * The one store for the running process. It is kept on globalThis because Next.js
 * can bundle server actions and route handlers separately, and each bundle would
 * otherwise get its own copy of module-level state.
 */
export function getFakeAuthStore(): FakeAuthStore {
  const g = globalThis as unknown as Record<string, FakeAuthStore | undefined>;
  return (g[STORE_KEY] ??= createFakeAuthStore());
}

/**
 * Empties the shared store in place, so providers already holding it (and its outbox)
 * see the reset. Browser tests call it through POST /api/test/reset so tests that share
 * the one fake Google account can run again on the same server.
 */
export function resetFakeAuthStore(): void {
  const store = getFakeAuthStore();
  store.users.clear();
  store.sessions.clear();
  store.enforceEmailInterval = false;
  store.lastEmailAt.clear();
  store.codes.clear();
  store.oauthCodes.clear();
  store.outbox.entries.length = 0;
  store.failNextSignOut = false;
  store.failNextRepair = false;
  store.profileTerms.clear();
}

/** Ends every session of a user, or every session but `keep`. */
function endSessions(store: FakeAuthStore, userId: string, keep?: string): void {
  for (const [sid, s] of store.sessions) if (s.userId === userId && sid !== keep) store.sessions.delete(sid);
}

/** Drops a user's outstanding codes (GoTrue does on any password change, probe m). */
function dropOutstandingCodes(store: FakeAuthStore, userId: string): void {
  for (const [key, code] of store.codes) if (code.userId === userId) store.codes.delete(key);
}

/**
 * Test mode only: every code issued so far stops working, as if their ten minutes had passed;
 * with `email`, only that address's codes (so browser tests running side by side do not expire
 * each other's codes). Codes sent afterwards work. Browser tests call it through
 * POST /api/test/expire-codes.
 */
export function expireAllCodes(store: FakeAuthStore = getFakeAuthStore(), email?: string): void {
  const only = email === undefined ? undefined : findFakeUserByEmail(store, email)?.id;
  if (email !== undefined && only === undefined) return;
  for (const code of store.codes.values()) if (only === undefined || code.userId === only) code.expired = true;
}

/** Removes a user with everything that points at it (sessions, codes). */
export function deleteFakeUser(store: FakeAuthStore, userId: string): void {
  store.users.delete(userId);
  // Like the profile row, which the user's deletion cascades to.
  store.profileTerms.delete(userId);
  endSessions(store, userId);
  dropOutstandingCodes(store, userId);
}

export function findFakeUserByEmail(store: FakeAuthStore, email: string): FakeUser | undefined {
  const wanted = normaliseEmail(email);
  for (const u of store.users.values()) if (u.email === wanted) return u;
  return undefined;
}

const SESSION_COOKIE = "fake-auth-session";
const MIN_PASSWORD_LENGTH = 8;
const GOOGLE_EMAIL = "google.user@example.test";
const GOOGLE_NAME = "Google User";

export function normaliseEmail(email: string) {
  return email.trim().toLowerCase();
}

/** CODE_LENGTH random digits, uniformly (bytes of 250 or more are drawn again). */
function randomDigits(): string {
  let out = "";
  while (out.length < CODE_LENGTH) {
    for (const byte of crypto.getRandomValues(new Uint8Array(CODE_LENGTH * 2))) {
      if (byte < 250 && out.length < CODE_LENGTH) out += String(byte % 10);
    }
  }
  return out;
}

/** A value nobody knows, standing in for an admin-set random password. */
function randomSecret(): string {
  return `${crypto.randomUUID()}${crypto.randomUUID()}`;
}

export function createFakeAuthProvider(deps: {
  store: FakeAuthStore;
  cookies: FakeCookies;
}): AuthProvider & { outbox: FakeOutbox } {
  const { store, cookies } = deps;

  const findByEmail = (email: string) => findFakeUserByEmail(store, email);

  const currentSession = () => {
    const sid = cookies.get(SESSION_COOKIE);
    return sid && store.sessions.has(sid) ? sid : undefined;
  };

  const currentUser = () => {
    const sid = currentSession();
    const session = sid ? store.sessions.get(sid) : undefined;
    return session ? store.users.get(session.userId) : undefined;
  };

  const requireUser = () => {
    const u = currentUser();
    if (!u) throw new AuthProviderError("unavailable", "Not signed in.");
    return u;
  };

  /** A new session for this browser (replacing the one it had). */
  const signInAs = (u: FakeUser, via: FakeSession["via"]) => {
    const old = cookies.get(SESSION_COOKIE);
    if (old) store.sessions.delete(old);
    const sid = crypto.randomUUID();
    store.sessions.set(sid, { userId: u.id, via });
    cookies.set(SESSION_COOKIE, sid);
  };

  const confirm = (u: FakeUser) => {
    u.confirmed = true;
    for (const identity of u.identities) if (identity.provider === "email") identity.verified = true;
  };

  /**
   * Called before each email is sent. With the test switch on, a second email of the same kind
   * to one account within EMAIL_INTERVAL_MS is refused, as GoTrue answers 429 (probe n). It is
   * kept per user (GoTrue stores the times on the user row), so a deleted pending account's
   * address can be signed up again at once (probe r).
   */
  function beforeEmail(user: FakeUser, kind: CodeKind) {
    const key = `${user.id}:${kind}`;
    const last = store.lastEmailAt.get(key);
    if (store.enforceEmailInterval && last !== undefined && Date.now() - last < EMAIL_INTERVAL_MS) {
      throw new AuthProviderError("rate_limited", "Too many attempts. Try again later.");
    }
    store.lastEmailAt.set(key, Date.now());
  }

  /** Emails a new code; it replaces (supersedes) the user's earlier code of that kind. */
  function issueCode(user: FakeUser, kind: CodeKind) {
    beforeEmail(user, kind);
    const code = randomDigits();
    store.codes.set(`${user.id}:${kind}`, { userId: user.id, kind, code, expired: false });
    store.outbox.add({ to: user.email, kind: "code", purpose: kind, code });
  }

  const toAuthUser = (u: FakeUser): AuthUser => ({
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    termsVersion: u.termsVersion,
    providerName: u.providerName ?? null,
  });

  return {
    outbox: store.outbox,

    async getUser() {
      const u = currentUser();
      return u ? toAuthUser(u) : null;
    },

    async signUpWithPassword({ email, password, displayName, termsVersion }) {
      if (password.length < MIN_PASSWORD_LENGTH) throw new AuthProviderError("weak_password");
      const existing = findByEmail(email);
      if (existing) {
        // Like real Supabase (checked live), the first password is kept, confirmed or not.
        // Unconfirmed: the same user, and a new email that supersedes the earlier code.
        // Confirmed: nothing is sent and the id is a stand-in, as Supabase obfuscates it.
        if (existing.confirmed) return { userId: crypto.randomUUID() };
        issueCode(existing, "signup");
        return { userId: existing.id };
      }
      const user: FakeUser = {
        id: crypto.randomUUID(),
        email: normaliseEmail(email),
        password,
        displayName,
        termsVersion,
        confirmed: false,
        identities: [{ provider: "email", verified: false }],
      };
      store.users.set(user.id, user);
      issueCode(user, "signup");
      return { userId: user.id };
    },

    async resendSignUpCode({ email }) {
      const u = findByEmail(email);
      if (u && !u.confirmed) issueCode(u, "signup");
    },

    async sendPasswordResetCode({ email }) {
      const u = findByEmail(email);
      if (u) issueCode(u, "recovery");
    },

    async verifyCode({ email, code, kind }): Promise<VerifyCodeResult> {
      const u = findByEmail(email);
      const live = u ? store.codes.get(`${u.id}:${kind}`) : undefined;
      if (!u || !live || live.expired || live.code !== code) return { ok: false, reason: "invalid_or_expired" };
      store.codes.delete(`${u.id}:${kind}`);
      // A recovery code proves the mailbox too, as in GoTrue.
      confirm(u);
      signInAs(u, "code");
      return { ok: true, userId: u.id };
    },

    async signInWithPassword({ email, password }) {
      const u = findByEmail(email);
      if (!u || !u.password || u.password !== password) return { ok: false, reason: "invalid_credentials" };
      if (!u.confirmed) return { ok: false, reason: "email_not_confirmed" };
      signInAs(u, "password");
      return { ok: true };
    },

    async startGoogleSignIn({ redirectTo }) {
      const code = crypto.randomUUID();
      store.oauthCodes.add(code);
      // prompt=select_account, as the real adapter asks Google, so browser tests can check it.
      const query = new URLSearchParams({ code, redirect_to: redirectTo, prompt: "select_account" });
      return { url: `/fake-google?${query.toString()}` };
    },

    async completeOAuth(code) {
      if (!store.oauthCodes.delete(code)) return false;
      let u = findByEmail(GOOGLE_EMAIL);
      if (!u) {
        u = {
          id: crypto.randomUUID(),
          email: GOOGLE_EMAIL,
          password: null,
          displayName: GOOGLE_NAME,
          termsVersion: null,
          confirmed: true,
          identities: [],
        };
        store.users.set(u.id, u);
      }
      if (!u.identities.some((i) => i.provider === "google")) u.identities.push({ provider: "google", verified: true });
      // As Supabase merges Google's claims (full_name) into the metadata; a typed display name stays.
      u.providerName = GOOGLE_NAME;
      u.confirmed = true;
      signInAs(u, "oauth");
      return true;
    },

    async updatePassword(newPassword) {
      const u = requireUser();
      const here = currentSession()!;
      if (newPassword.length < MIN_PASSWORD_LENGTH) throw new AuthProviderError("weak_password");
      // Probe (l): GoTrue answers 400 current_password_required from a password sign-in session.
      if (store.sessions.get(here)?.via === "password") {
        throw new AuthProviderError("reauth_required", "The password could not be changed from this session.");
      }
      u.password = newPassword;
      // Probes (l2), (m): the user's other sessions end and outstanding codes stop working,
      // with or without signOutOthers (the option only asks for what already happens).
      endSessions(store, u.id, here);
      dropOutstandingCodes(store, u.id);
    },

    async scramblePassword(userId) {
      const u = store.users.get(userId);
      if (!u) throw new AuthProviderError("unavailable", "The account could not be updated.");
      u.password = randomSecret();
      // Probes (k), (m): an admin password update ends EVERY session of the user, the caller's
      // too, and outstanding codes stop working.
      endSessions(store, u.id);
      dropOutstandingCodes(store, u.id);
    },

    async openSessionWithoutEmail({ email, expectedUserId }) {
      const u = findByEmail(email);
      if (!u) throw new AuthProviderError("unavailable", "The account could not be signed in.");
      // As admin generateLink(recovery) + verifyOtp (probes p, q): no email; the new recovery
      // code replaces any earlier one and is redeemed at once; a code session in this browser.
      // Sessions ended by a scramble stay ended. The provider records recovery_sent_at, which
      // is assumed (not probed) to start the recovery email interval.
      store.codes.delete(`${u.id}:recovery`);
      store.lastEmailAt.set(`${u.id}:recovery`, Date.now());
      confirm(u);
      signInAs(u, "code");
      if (u.id !== expectedUserId) {
        // As the adapter: the unexpected user's new session is signed out at once; no id is named.
        const sid = cookies.get(SESSION_COOKIE);
        if (sid) store.sessions.delete(sid);
        cookies.delete(SESSION_COOKIE);
        throw new AuthProviderError("unavailable", "The account could not be signed in.");
      }
      return { userId: u.id };
    },

    async acceptTerms({ termsVersion }) {
      requireUser().termsVersion = termsVersion;
    },

    async clearTermsAcceptance() {
      requireUser().termsVersion = null;
    },

    async resetUserMetadata(userId, { displayName, acceptedTermsVersion }) {
      const u = store.users.get(userId);
      if (!u) throw new AuthProviderError("unavailable", "The account could not be updated.");
      u.displayName = displayName;
      u.termsVersion = acceptedTermsVersion ?? null;
    },

    async updateDisplayName(name) {
      requireUser().displayName = name;
    },

    async signOut() {
      if (store.failNextSignOut) {
        store.failNextSignOut = false;
        throw new AuthProviderError("unavailable", "Sign-out failed (test mode).");
      }
      const sid = cookies.get(SESSION_COOKIE);
      if (sid) store.sessions.delete(sid);
      cookies.delete(SESSION_COOKIE);
    },
  };
}
