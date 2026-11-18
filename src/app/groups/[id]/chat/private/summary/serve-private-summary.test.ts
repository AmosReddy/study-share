import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { connection, requireDirectChatDeps } = vi.hoisted(() => ({
  connection: vi.fn(async () => {}),
  requireDirectChatDeps: vi.fn(),
}));

vi.mock("next/server", () => ({ connection }));
vi.mock("@/server/chat/direct-request-deps", () => ({ requireDirectChatDeps }));

import { createFakeAuthStore } from "@/server/adapters/fake-auth-provider";
import { createFakeDirectChatStore, resetFakeDirectChatStore } from "@/server/adapters/fake-direct-chat-store";
import { createFakeGroupStore, resetFakeGroupStore } from "@/server/adapters/fake-group-store";
import { createMemoryRateLimiter } from "@/server/adapters/memory-rate-limiter";
import type { DirectChatDeps } from "@/server/chat/direct-use-cases";
import { chatKeyFor } from "@/server/groups/chat-key";
import { newGroupCode, newInviteToken } from "@/server/groups/secrets";
import { servePrivateSummary } from "./serve-private-summary";

type Person = { id: string; displayName: string };
const SECRET = "test-secret";

function world() {
  resetFakeGroupStore();
  resetFakeDirectChatStore();
  const auth = createFakeAuthStore();
  const groups = createFakeGroupStore(auth);
  const direct = createFakeDirectChatStore(auth);
  const limiter = createMemoryRateLimiter();
  const person = (displayName: string): Person => {
    const id = crypto.randomUUID();
    auth.users.set(id, { id, email: `${id}@example.test`, password: null, displayName, termsVersion: null, confirmed: true, identities: [] });
    return { id, displayName };
  };
  const as = (user: Person): DirectChatDeps => ({ groups, limiter, siteUrl: "https://app.test", ip: "10.0.0.1", user, direct, secret: SECRET });
  return { groups, direct, person, as };
}

async function crowd() {
  const t = world();
  const asha = t.person("Asha");
  const ravi = t.person("Ravi");
  const mina = t.person("Mina");
  const zed = t.person("Zed");
  const result = await t.groups.createGroup({
    ownerId: asha.id,
    name: "Chemistry",
    description: "",
    joinMode: "link",
    passwordHash: null,
    inviteToken: newInviteToken(),
    inviteCode: newGroupCode(),
  });
  if (!result.ok) throw new Error(result.reason);
  const groupId = result.group.id;
  for (const who of [ravi, mina]) await t.groups.addMember(groupId, who.id);
  return { t, asha, ravi, mina, zed, groupId };
}

function get(deps: DirectChatDeps, groupId: string) {
  requireDirectChatDeps.mockResolvedValue(deps);
  return servePrivateSummary(Promise.resolve({ id: groupId }));
}

beforeEach(() => {
  connection.mockClear();
  requireDirectChatDeps.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /groups/[id]/chat/private/summary", () => {
  it("waits for a real request first, then answers the person's own chats and unread dots as no-store JSON", async () => {
    const { t, ravi, mina, groupId } = await crowd();
    const { chatId } = await t.direct.openChat(groupId, ravi.id, mina.id);
    await t.direct.send({ chatId, senderId: ravi.id, clientId: crypto.randomUUID(), body: "hello\nthere" });

    const response = await get(t.as(mina), groupId);
    expect(connection).toHaveBeenCalledTimes(1);
    expect(connection.mock.invocationCallOrder[0]).toBeLessThan(requireDirectChatDeps.mock.invocationCallOrder[0]);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Type")).toMatch(/application\/json/);
    const body = await response.json();
    expect(body).toEqual({
      chats: [{ chatId, name: "Ravi", otherGone: false, preview: "hello there", lastAt: expect.any(String), unread: true }],
      unread: { any: true, fromChatKeys: [chatKeyFor(SECRET, groupId, ravi.id)] },
    });
    expect(JSON.stringify(body)).not.toContain(ravi.id);
    expect(JSON.stringify(body)).not.toContain(mina.id);
  });

  it("shows each person only their own chats: the owner and a third member see nothing of the other two's chat", async () => {
    const { t, asha, ravi, mina, groupId } = await crowd();
    const { chatId } = await t.direct.openChat(groupId, ravi.id, mina.id);
    await t.direct.send({ chatId, senderId: ravi.id, clientId: crypto.randomUUID(), body: "secret" });
    for (const who of [asha]) {
      const response = await get(t.as(who), groupId);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ chats: [], unread: { any: false, fromChatKeys: [] } });
    }
    const sender = await (await get(t.as(ravi), groupId)).json();
    expect(sender.chats).toHaveLength(1);
    expect(sender.unread).toEqual({ any: false, fromChatKeys: [] });
  });

  it("answers a stranger, a removed member, an unknown group, a malformed id and a deleted group with the same bare 404", async () => {
    const { t, ravi, zed, groupId } = await crowd();
    await t.groups.removeMember(groupId, ravi.id);
    const attempts: [string, Person][] = [
      [groupId, zed],
      [groupId, ravi],
      [crypto.randomUUID(), zed],
      ["not-a-uuid", zed],
    ];
    for (const [id, who] of attempts) {
      const response = await get(t.as(who), id);
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("Not found");
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    }
    await t.groups.softDeleteGroup(groupId);
    expect((await get(t.as(zed), groupId)).status).toBe(404);
  });

  it("a signed-out visitor is sent on by requireDirectChatDeps", async () => {
    const { groupId } = await crowd();
    requireDirectChatDeps.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(servePrivateSummary(Promise.resolve({ id: groupId }))).rejects.toThrow("NEXT_REDIRECT");
  });

  it("a store outage is a 503 with a fixed text and a fixed log line, never a 404", async () => {
    const { t, mina, groupId } = await crowd();
    const deps = t.as(mina);
    deps.direct = { ...t.direct, listChatsFor: async () => Promise.reject(new Error("db down at secret-host")) };
    const response = await get(deps, groupId);
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Retry-After")).toBe("5");
    expect(await response.text()).not.toContain("secret-host");
    expect(vi.mocked(console.error).mock.calls).toEqual([["Could not load the private chats."]]);
  });
});
