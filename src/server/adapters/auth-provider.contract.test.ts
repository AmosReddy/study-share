import { createFakeAuthProvider, createFakeAuthStore } from "./fake-auth-provider";
import { runAuthProviderContract } from "./auth-provider.contract";

runAuthProviderContract(() => {
  const jar = new Map<string, string>();
  const provider = createFakeAuthProvider({
    store: createFakeAuthStore(),
    cookies: {
      get: (name) => jar.get(name),
      set: (name, value) => void jar.set(name, value),
      delete: (name) => void jar.delete(name),
    },
  });
  return { provider, outbox: provider.outbox };
});
