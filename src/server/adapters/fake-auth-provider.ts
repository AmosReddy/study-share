import { AuthProviderError, type AuthProvider, type AuthUser } from "../ports/auth-provider";

/*
  Test-mode sign-in. No vendor library and no network. Passwords are kept as
  plain text in memory because this fake only runs in test mode; they are never
  logged or put in an error. Emails are "sent" to an in-memory outbox so tests
  can follow the links.
*/

export type FakeOutboxEntry = { to: string; kind: "confirm" | "reset"; url: string };

export class FakeOutbox {
  readonly entries: FakeOutboxEntry[] = [];

  add(entry: FakeOutboxEntry) {
    this.entries.push(entry);
  }

  lastFor(email: string): FakeOutboxEntry | undefined {
    const to = normaliseEmail(email);
    for (let i = this.entries.length - 1; i >= 0; i--) {
      if (this.entries[i].to === to) return this.entries[i];
    }
    return undefined;
  }
}

type FakeUser = {
  id: string;
  email: string;
  password: string;
  displayName: string;
  termsVersion: string | null;
  confirmed: boolean;
};

export type FakeAuthStore = {
  users: Map<string, FakeUser>;
  /** Single-use email tokens. */
  tokens: Map<string, { userId: string; type: "email" | "recovery" }>;
  /** Single-use codes handed out by startGoogleSignIn. */
  oauthCodes: Set<string>;
  outbox: FakeOutbox;
  /** Test mode only: the next signOut throws once, so browser tests can see a failed log-out. */
  failNextSignOut: boolean;
};

export type FakeCookies = {
  get(name: string): string | undefined;
  set(name: string, value: string): void;
  delete(name: string): void;
};

export function createFakeAuthStore(): FakeAuthStore {
  return { users: new Map(), tokens: new Map(), oauthCodes: new Set(), outbox: new FakeOutbox(), failNextSignOut: false };
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
  store.tokens.clear();
  store.oauthCodes.clear();
  store.outbox.entries.length = 0;
  store.failNextSignOut = false;
}

const SESSION_COOKIE = "fake-auth-session";
const MIN_PASSWORD_LENGTH = 8;
const GOOGLE_EMAIL = "google.user@example.test";

function normaliseEmail(email: string) {
  return email.trim().toLowerCase();
}

export function createFakeAuthProvider(deps: {
  store: FakeAuthStore;
  cookies: FakeCookies;
}): AuthProvider & { outbox: FakeOutbox } {
  const { store, cookies } = deps;

  const findByEmail = (email: string) => {
    const wanted = normaliseEmail(email);
    for (const u of store.users.values()) if (u.email === wanted) return u;
    return undefined;
  };

  const currentUser = () => {
    const id = cookies.get(SESSION_COOKIE);
    return id ? store.users.get(id) : undefined;
  };

  const requireUser = () => {
    const u = currentUser();
    if (!u) throw new AuthProviderError("unavailable", "Not signed in.");
    return u;
  };

  const signInAs = (u: FakeUser) => cookies.set(SESSION_COOKIE, u.id);

  function issueToken(user: FakeUser, type: "email" | "recovery", redirectTo: string) {
    const token = crypto.randomUUID();
    store.tokens.set(token, { userId: user.id, type });
    const query = new URLSearchParams({ token_hash: token, type, redirect_to: redirectTo });
    store.outbox.add({
      to: user.email,
      kind: type === "email" ? "confirm" : "reset",
      url: `/auth/confirm?${query.toString()}`,
    });
  }

  const toAuthUser = (u: FakeUser): AuthUser => ({
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    termsVersion: u.termsVersion,
  });

  return {
    outbox: store.outbox,

    async getUser() {
      const u = currentUser();
      return u ? toAuthUser(u) : null;
    },

    async signUpWithPassword({ email, password, displayName, termsVersion, redirectTo }) {
      if (password.length < MIN_PASSWORD_LENGTH) throw new AuthProviderError("weak_password");
      const existing = findByEmail(email);
      if (existing) {
        // Same outward result as a new sign-up. Never replace the first password.
        if (!existing.confirmed) issueToken(existing, "email", redirectTo);
        return;
      }
      const user: FakeUser = {
        id: crypto.randomUUID(),
        email: normaliseEmail(email),
        password,
        displayName,
        termsVersion,
        confirmed: false,
      };
      store.users.set(user.id, user);
      issueToken(user, "email", redirectTo);
    },

    async resendConfirmation({ email, redirectTo }) {
      const u = findByEmail(email);
      if (u && !u.confirmed) issueToken(u, "email", redirectTo);
    },

    async signInWithPassword({ email, password }) {
      const u = findByEmail(email);
      if (!u || u.password !== password) return { ok: false, reason: "invalid_credentials" };
      if (!u.confirmed) return { ok: false, reason: "email_not_confirmed" };
      signInAs(u);
      return { ok: true };
    },

    async startGoogleSignIn({ redirectTo }) {
      const code = crypto.randomUUID();
      store.oauthCodes.add(code);
      const query = new URLSearchParams({ code, redirect_to: redirectTo });
      return { url: `/fake-google?${query.toString()}` };
    },

    async completeOAuth(code) {
      if (!store.oauthCodes.delete(code)) return false;
      let u = findByEmail(GOOGLE_EMAIL);
      if (!u) {
        u = {
          id: crypto.randomUUID(),
          email: GOOGLE_EMAIL,
          password: crypto.randomUUID(),
          displayName: "Google User",
          termsVersion: null,
          confirmed: true,
        };
        store.users.set(u.id, u);
      }
      u.confirmed = true;
      signInAs(u);
      return true;
    },

    async confirmEmailToken({ tokenHash, type }) {
      const pending = store.tokens.get(tokenHash);
      if (!pending || pending.type !== type) return false;
      store.tokens.delete(tokenHash);
      const u = store.users.get(pending.userId);
      if (!u) return false;
      u.confirmed = true;
      signInAs(u);
      return true;
    },

    async sendPasswordReset({ email, redirectTo }) {
      const u = findByEmail(email);
      if (u) issueToken(u, "recovery", redirectTo);
    },

    async updatePassword(newPassword) {
      const u = requireUser();
      if (newPassword.length < MIN_PASSWORD_LENGTH) throw new AuthProviderError("weak_password");
      u.password = newPassword;
    },

    async acceptTerms({ termsVersion }) {
      requireUser().termsVersion = termsVersion;
    },

    async updateDisplayName(name) {
      requireUser().displayName = name;
    },

    async signOut() {
      if (store.failNextSignOut) {
        store.failNextSignOut = false;
        throw new AuthProviderError("unavailable", "Sign-out failed (test mode).");
      }
      cookies.delete(SESSION_COOKIE);
    },
  };
}
