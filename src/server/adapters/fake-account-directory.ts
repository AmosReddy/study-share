import type { AccountDirectory, EmailAccountState } from "../ports/account-directory";
import { deleteFakeUser, findFakeUserByEmail, getFakeAuthStore, type FakeAuthStore, type FakeUser } from "./fake-auth-provider";

/*
  Test-mode AccountDirectory over the fake auth store (the same globalThis-kept store the
  fake provider uses), answering as the SQL directory in src/server/db/account-directory.ts
  does: a user with any non-email identity is never pending and never removed.
*/

const hasNonEmailIdentity = (u: FakeUser) => u.identities.some((i) => i.provider !== "email");

export function createFakeAccountDirectory(store: FakeAuthStore = getFakeAuthStore()): AccountDirectory {
  return {
    async describeEmail(email) {
      const u = findFakeUserByEmail(store, email);
      if (!u) return { kind: "none" } satisfies EmailAccountState;
      if (!u.confirmed && !hasNonEmailIdentity(u)) return { kind: "pending", userId: u.id };
      const providers: ("email" | "google")[] = [];
      if (u.identities.some((i) => i.provider === "email")) providers.push("email");
      if (u.identities.some((i) => i.provider === "google")) providers.push("google");
      return { kind: "confirmed", userId: u.id, providers, hasPassword: !!u.password };
    },

    async removePendingSignup(email) {
      // Synchronous check-and-delete, so of two calls only the first finds the user.
      const u = findFakeUserByEmail(store, email);
      if (!u || u.confirmed || hasNonEmailIdentity(u)) return false;
      deleteFakeUser(store, u.id);
      return true;
    },

    async repairAfterGoogle(userId) {
      const u = store.users.get(userId);
      if (!u || !u.identities.some((i) => i.provider === "google")) return { hadPendingEmailSignup: false };
      const before = u.identities.length;
      u.identities = u.identities.filter((i) => !(i.provider === "email" && !i.verified));
      return { hadPendingEmailSignup: u.identities.length < before };
    },
  };
}
