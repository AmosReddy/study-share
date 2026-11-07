import { createFakeAuthProvider, createFakeAuthStore, expireAllCodes, type FakeAuthStore } from "./fake-auth-provider";
import { runAuthProviderContract } from "./auth-provider.contract";

function deviceOn(store: FakeAuthStore) {
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

runAuthProviderContract(() => {
  const store = createFakeAuthStore();
  const provider = deviceOn(store);
  return {
    provider,
    outbox: provider.outbox,
    otherDevice: () => deviceOn(store),
    expireAllCodes: () => expireAllCodes(store),
  };
});
