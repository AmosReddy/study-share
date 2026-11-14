import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: vi.fn(async () => {}),
}));

import { getFakeAuthStore, resetFakeAuthStore } from "@/server/adapters/fake-auth-provider";
import { createFakeFileStorage, resetFakeFileStorage } from "@/server/adapters/fake-file-storage";
import { createFakeGroupStore, resetFakeGroupStore } from "@/server/adapters/fake-group-store";
import { createFakeMessageStore, resetFakeMessageStore } from "@/server/adapters/fake-message-store";
import { createFakeResourceStore, resetFakeResourceStore } from "@/server/adapters/fake-resource-store";
import { POST } from "./route";

async function seed() {
  const auth = getFakeAuthStore();
  auth.users.set("u1", {
    id: "u1",
    email: "ada@example.test",
    password: null,
    displayName: "Ada",
    termsVersion: null,
    confirmed: true,
    identities: [],
  });
  const groups = createFakeGroupStore(auth);
  const made = await groups.createGroup({
    ownerId: "u1",
    name: "Maths",
    description: "",
    joinMode: "link",
    passwordHash: null,
    inviteToken: "token-1",
    inviteCode: "ABCDEFGH",
  });
  if (!made.ok) throw new Error("seed failed");
  return { auth, groups };
}

describe("POST /api/test/reset", () => {
  beforeEach(() => {
    resetFakeAuthStore();
    resetFakeGroupStore();
    resetFakeResourceStore();
    resetFakeMessageStore();
    resetFakeFileStorage();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    resetFakeAuthStore();
    resetFakeGroupStore();
  });

  test("is not found outside test mode and clears nothing", async () => {
    const { auth, groups } = await seed();
    for (const mode of ["real", "", undefined]) {
      vi.stubEnv("SERVICES_MODE", mode);
      expect((await POST()).status).toBe(404);
    }
    expect(auth.users.size).toBe(1);
    expect(await groups.listGroupsFor("u1")).toHaveLength(1);
  });

  test("in test mode it clears the fake auth store and the fake group store", async () => {
    vi.stubEnv("SERVICES_MODE", "fake");
    const { auth, groups } = await seed();
    expect((await POST()).status).toBe(204);
    expect(auth.users.size).toBe(0);
    // The store made before the reset sees it: the state is cleared in place.
    expect(await groups.listGroupsFor("u1")).toEqual([]);
    expect(await groups.findByInvite({ token: "token-1" })).toBeNull();
  });

  test("in test mode it also clears the shared files and the stored objects", async () => {
    vi.stubEnv("SERVICES_MODE", "fake");
    const { auth, groups } = await seed();
    const group = (await groups.listGroupsFor("u1"))[0];
    const resources = createFakeResourceStore(auth);
    const storage = createFakeFileStorage({ siteUrl: "http://localhost:3000" });
    const uploader = "22222222-2222-4222-8222-222222222222";
    auth.users.set(uploader, {
      id: uploader,
      email: "bo@example.test",
      password: null,
      displayName: "Bo",
      termsVersion: null,
      confirmed: true,
      identities: [],
    });
    const made = await resources.createPending({
      id: "11111111-1111-4111-8111-111111111111",
      groupId: group.id,
      uploaderId: uploader,
      title: "Notes",
      subject: "",
      type: "notes",
      fileKey: "k/a.pdf",
      fileName: "a.pdf",
      contentType: "application/pdf",
      sizeBytes: 1,
    });
    await storage.put("k/a.pdf", "x", "application/pdf");
    expect(await resources.findById(group.id, made.id)).not.toBeNull();
    expect((await POST()).status).toBe(204);
    expect(await storage.head("k/a.pdf")).toBeNull();
    // resetFakeGroupStore ran too, so the group is gone and so is the file with it; the shared
    // state itself is empty.
    expect(await resources.findById(group.id, made.id)).toBeNull();
    expect((globalThis as unknown as Record<string, { resources: Map<string, unknown> }>)["__studyShareFakeResourceStore"].resources.size).toBe(0);
  });

  test("in test mode it also clears the chat messages", async () => {
    vi.stubEnv("SERVICES_MODE", "fake");
    const { auth, groups } = await seed();
    const group = (await groups.listGroupsFor("u1"))[0];
    const messages = createFakeMessageStore(auth);
    const sender = "55555555-5555-4555-8555-555555555555";
    auth.users.set(sender, {
      id: sender,
      email: "cy@example.test",
      password: null,
      displayName: "Cy",
      termsVersion: null,
      confirmed: true,
      identities: [],
    });
    const sent = await messages.send({
      groupId: group.id,
      senderId: sender,
      clientId: "44444444-4444-4444-8444-444444444444",
      body: "hello",
    });
    expect(await messages.findById(group.id, sent.message.id)).not.toBeNull();
    expect((globalThis as unknown as Record<string, { messages: Map<string, unknown> }>)["__studyShareFakeMessageStore"].messages.size).toBe(1);
    expect((await POST()).status).toBe(204);
    expect((globalThis as unknown as Record<string, { messages: Map<string, unknown> }>)["__studyShareFakeMessageStore"].messages.size).toBe(0);
  });
});
