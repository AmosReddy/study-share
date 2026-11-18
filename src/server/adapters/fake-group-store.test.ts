import { describe, expect, it } from "vitest";
import { DEFAULT_FORM_CONFIG, type FormConfig } from "@/shared/form-config";
import { getFakeAuthStore, resetFakeAuthStore } from "./fake-auth-provider";
import { createFakeGroupStore, resetFakeGroupStore, setFakeGroupFormConfig } from "./fake-group-store";
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

describe("the fake's form helpers", () => {
  const owner = () => {
    const id = crypto.randomUUID();
    getFakeAuthStore().users.set(id, {
      id,
      email: `${id}@example.test`,
      password: null,
      displayName: "Owner",
      termsVersion: null,
      confirmed: true,
      identities: [],
    });
    return id;
  };
  const custom: FormConfig = { version: 4, types: [{ id: "a1", label: "Notes" }], fields: [] };

  async function newGroup() {
    resetFakeAuthStore();
    resetFakeGroupStore();
    const store = createFakeGroupStore(getFakeAuthStore());
    const created = await store.createGroup({
      ownerId: owner(),
      name: "G",
      description: "",
      joinMode: "link",
      passwordHash: null,
      inviteToken: `t-${crypto.randomUUID()}`,
      inviteCode: "ABCDEFGH",
    });
    if (!created.ok) throw new Error(created.reason);
    return { store, group: created.group };
  }

  it("setFakeGroupFormConfig still works, and updateFormConfig then compares with the version it set", async () => {
    const { store, group } = await newGroup();
    expect(setFakeGroupFormConfig(group.id, custom)).toBe(true);
    expect((await store.findById(group.id))?.formConfig).toEqual(custom);
    expect(await store.updateFormConfig(group.id, 1, { ...custom, version: 5 })).toBe("stale");
    expect(await store.updateFormConfig(group.id, 4, { ...custom, version: 5 })).toBe("saved");
    expect((await store.findById(group.id))?.formConfig.version).toBe(5);
  });

  it("a form that is not valid is read as the default (version 1), as the database store reads it", async () => {
    const { store, group } = await newGroup();
    expect(await store.updateFormConfig(group.id, 1, { version: 2, types: "x" } as unknown as FormConfig)).toBe("saved");
    expect((await store.findById(group.id))?.formConfig).toEqual(DEFAULT_FORM_CONFIG);
    // So the next save starts from version 1 again, and the owner can repair it.
    expect(await store.updateFormConfig(group.id, 1, custom)).toBe("saved");
  });

  it("the stored form shares nothing with the object that was saved", async () => {
    const { store, group } = await newGroup();
    const saved: FormConfig = { version: 2, types: [{ id: "a1", label: "Notes" }], fields: [] };
    await store.updateFormConfig(group.id, 1, saved);
    saved.types[0].label = "Changed afterwards";
    expect((await store.findById(group.id))?.formConfig.types[0].label).toBe("Notes");
  });
});
