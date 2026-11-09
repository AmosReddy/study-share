import type { ProfileStore } from "../ports/profile-store";
import { getFakeAuthStore, type FakeAuthStore } from "./fake-auth-provider";

/*
  Test-mode ProfileStore over the fake auth store (the same globalThis-kept store the fake
  provider uses), answering as the SQL store in src/server/db/profile-store.ts does: a profile
  exists exactly when the user does, and one time stamps both the terms and the age.
*/

export function createFakeProfileStore(store: FakeAuthStore = getFakeAuthStore()): ProfileStore {
  return {
    async recordTermsAcceptance(userId, termsVersion) {
      if (!store.users.has(userId)) return false;
      const now = new Date();
      store.profileTerms.set(userId, { termsVersion, termsAcceptedAt: now, ageConfirmedAt: now });
      return true;
    },

    async clearTermsAcceptance(userId) {
      if (!store.users.has(userId)) return false;
      store.profileTerms.set(userId, { termsVersion: null, termsAcceptedAt: null, ageConfirmedAt: null });
      return true;
    },
  };
}
