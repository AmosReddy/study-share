import { getFakeAuthStore, resetFakeAuthStore } from "./fake-auth-provider";
import { createFakeGroupStore, resetFakeGroupStore } from "./fake-group-store";
import { runGroupStoreContract } from "./group-store.contract";

runGroupStoreContract(async (run) => {
  resetFakeAuthStore();
  resetFakeGroupStore();
  const auth = getFakeAuthStore();
  let n = 0;
  const addUser = (name?: string) => {
    n += 1;
    const id = crypto.randomUUID();
    auth.users.set(id, {
      id,
      email: `person${n}@example.test`,
      password: null,
      displayName: name ?? `Person ${n}`,
      termsVersion: null,
      confirmed: true,
      identities: [],
    });
    return id;
  };
  try {
    await run({
      store: createFakeGroupStore(auth),
      newUser: async (name) => addUser(name),
      newUsers: async (count) => Array.from({ length: count }, () => addUser()),
    });
  } finally {
    resetFakeGroupStore();
    resetFakeAuthStore();
  }
});
