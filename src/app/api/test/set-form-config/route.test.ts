import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: vi.fn(async () => {}),
}));

import { createFakeGroupStore, resetFakeGroupStore } from "@/server/adapters/fake-group-store";
import { getFakeAuthStore, resetFakeAuthStore } from "@/server/adapters/fake-auth-provider";
import { DEFAULT_FORM_CONFIG, type FormConfig } from "@/shared/form-config";
import { POST } from "./route";

const CONFIG: FormConfig = {
  version: 1,
  types: [{ id: "t_lecture", label: "Lecture notes" }],
  fields: [{ id: "f_sem", label: "Semester", kind: "dropdown", required: true, options: [{ id: "o_1", label: "Semester 1" }, { id: "o_2", label: "Semester 2" }] }],
};

const post = (body: unknown) =>
  POST(new Request("http://localhost/api/test/set-form-config", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));

async function makeGroup() {
  const ownerId = crypto.randomUUID();
  getFakeAuthStore().users.set(ownerId, {
    id: ownerId,
    email: "owner@example.invalid",
    password: null,
    displayName: "Owner",
    termsVersion: "2026-11-06",
    confirmed: true,
    identities: [],
  });
  const store = createFakeGroupStore();
  const created = await store.createGroup({
    ownerId,
    name: "Form group",
    description: "",
    joinMode: "link",
    passwordHash: null,
    inviteToken: "token-for-the-form-group",
    inviteCode: "ABCDEFGH",
  });
  if (!created.ok) throw new Error("the group was not created");
  return { store, groupId: created.group.id };
}

describe("POST /api/test/set-form-config", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetFakeGroupStore();
    resetFakeAuthStore();
  });

  test("is not found outside test mode and changes nothing", async () => {
    const { store, groupId } = await makeGroup();
    for (const mode of ["real", "", undefined]) {
      vi.stubEnv("SERVICES_MODE", mode);
      expect((await post({ groupId, config: CONFIG })).status).toBe(404);
    }
    expect((await store.findById(groupId))?.formConfig).toEqual(DEFAULT_FORM_CONFIG);
  });

  test("in test mode gives the group its own form", async () => {
    vi.stubEnv("SERVICES_MODE", "fake");
    const { store, groupId } = await makeGroup();
    expect((await post({ groupId, config: CONFIG })).status).toBe(204);
    expect((await store.findById(groupId))?.formConfig).toEqual(CONFIG);
    // The default can be put back.
    expect((await post({ groupId, config: DEFAULT_FORM_CONFIG })).status).toBe(204);
    expect((await store.findById(groupId))?.formConfig).toEqual(DEFAULT_FORM_CONFIG);
  });

  test("an unknown group, a missing group id and unreadable input are not found", async () => {
    vi.stubEnv("SERVICES_MODE", "fake");
    await makeGroup();
    expect((await post({ groupId: crypto.randomUUID(), config: CONFIG })).status).toBe(404);
    expect((await post({ config: CONFIG })).status).toBe(404);
    expect((await post({ groupId: 7, config: CONFIG })).status).toBe(404);
    expect((await post("not json")).status).toBe(404);
  });

  test("a configuration that is not valid is refused and changes nothing", async () => {
    vi.stubEnv("SERVICES_MODE", "fake");
    const { store, groupId } = await makeGroup();
    expect((await post({ groupId, config: { version: 1, types: [{ id: "other", label: "X" }], fields: [] } })).status).toBe(400);
    expect((await post({ groupId })).status).toBe(400);
    expect((await store.findById(groupId))?.formConfig).toEqual(DEFAULT_FORM_CONFIG);
  });
});
