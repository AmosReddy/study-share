import { runDirectChatStoreContract } from "./direct-chat-store.contract";
import { getFakeAuthStore, resetFakeAuthStore } from "./fake-auth-provider";
import { createFakeDirectChatStore, resetFakeDirectChatStore } from "./fake-direct-chat-store";
import { createFakeGroupStore, resetFakeGroupStore } from "./fake-group-store";
import { resetFakeMessageStore } from "./fake-message-store";

runDirectChatStoreContract(async (run) => {
  resetFakeAuthStore();
  resetFakeGroupStore();
  resetFakeMessageStore();
  resetFakeDirectChatStore();
  const auth = getFakeAuthStore();
  const groups = createFakeGroupStore(auth);
  let n = 0;
  try {
    await run({
      store: createFakeDirectChatStore(auth),
      newUser: async (name) => {
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
      },
      newGroup: async (ownerId) => {
        n += 1;
        const result = await groups.createGroup({
          ownerId,
          name: `Group ${n}`,
          description: "",
          joinMode: "link",
          passwordHash: null,
          inviteToken: `token-${crypto.randomUUID()}`,
          inviteCode: `CODE${String(n).padStart(4, "0")}`,
        });
        if (!result.ok) throw new Error(`createGroup failed: ${result.reason}`);
        return result.group.id;
      },
      deleteGroup: async (groupId) => {
        await groups.softDeleteGroup(groupId);
      },
      deleteUser: async (userId) => {
        auth.users.delete(userId);
      },
      join: async (groupId, userId) => {
        await groups.addMember(groupId, userId);
      },
      removeMember: async (groupId, userId) => {
        if (!(await groups.removeMember(groupId, userId))) throw new Error("removeMember refused");
      },
    });
  } finally {
    resetFakeDirectChatStore();
    resetFakeMessageStore();
    resetFakeGroupStore();
    resetFakeAuthStore();
  }
});
