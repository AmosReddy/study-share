import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { connection, requireChatDeps } = vi.hoisted(() => ({
  connection: vi.fn(async () => {}),
  requireChatDeps: vi.fn(),
}));

vi.mock("next/server", () => ({ connection }));
vi.mock("@/server/chat/request-deps", () => ({ requireChatDeps }));

import { createFakeAuthStore } from "@/server/adapters/fake-auth-provider";
import { createFakeGroupStore, resetFakeGroupStore } from "@/server/adapters/fake-group-store";
import { createFakeMessageStore, resetFakeMessageStore } from "@/server/adapters/fake-message-store";
import { createMemoryRateLimiter } from "@/server/adapters/memory-rate-limiter";
import { newGroupCode, newInviteToken } from "@/server/groups/secrets";
import type { ChatDeps } from "@/server/chat/use-cases";
import { serveMessages } from "./serve-messages";

type Person = { id: string; displayName: string };

function world() {
  resetFakeGroupStore();
  resetFakeMessageStore();
  const auth = createFakeAuthStore();
  const groups = createFakeGroupStore(auth);
  const messages = createFakeMessageStore(auth);
  const limiter = createMemoryRateLimiter();
  const person = (displayName: string): Person => {
    const id = crypto.randomUUID();
    auth.users.set(id, { id, email: `${id}@example.test`, password: null, displayName, termsVersion: null, confirmed: true, identities: [] });
    return { id, displayName };
  };
  const as = (user: Person): ChatDeps => ({ groups, limiter, siteUrl: "https://app.test", ip: "10.0.0.1", user, messages });
  const makeGroup = async (owner: Person) => {
    const result = await groups.createGroup({
      ownerId: owner.id,
      name: "Chemistry",
      description: "",
      joinMode: "link",
      passwordHash: null,
      inviteToken: newInviteToken(),
      inviteCode: newGroupCode(),
    });
    if (!result.ok) throw new Error(result.reason);
    return result.group.id;
  };
  return { groups, messages, person, as, makeGroup };
}

/** Calls the handler as `deps.user`, for an address like "?after=abc". */
function get(deps: ChatDeps, groupId: string, query = "") {
  requireChatDeps.mockResolvedValue(deps);
  const url = new URL(`https://app.test/groups/${groupId}/chat/messages${query}`);
  return serveMessages(Promise.resolve({ id: groupId }), { nextUrl: url } as never);
}

const send = (t: ReturnType<typeof world>, who: Person, groupId: string, body: string) =>
  t.messages.send({ groupId, senderId: who.id, clientId: crypto.randomUUID(), body });

beforeEach(() => {
  connection.mockClear();
  requireChatDeps.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /groups/[id]/chat/messages", () => {
  it("waits for a real request first, then answers JSON with no-store", async () => {
    const t = world();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    await send(t, owner, groupId, "hello");
    const response = await get(t.as(owner), groupId);
    expect(connection).toHaveBeenCalledTimes(1);
    expect(connection.mock.invocationCallOrder[0]).toBeLessThan(requireChatDeps.mock.invocationCallOrder[0]);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Type")).toMatch(/application\/json/);
    const body = await response.json();
    expect(body).toMatchObject({ hasMore: false, canDeleteAny: true, messages: [{ body: "hello", senderName: "Asha", mine: true }] });
    expect(JSON.stringify(body)).not.toContain(owner.id);
  });

  it("returns newer messages for ?after and an earlier page for ?before", async () => {
    const t = world();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    const first = (await send(t, owner, groupId, "one")).message;
    await send(t, owner, groupId, "two");
    const third = (await send(t, owner, groupId, "three")).message;

    const news = await (await get(t.as(owner), groupId, `?after=${first.cursor}`)).json();
    expect(news.messages.map((m: { body: string }) => m.body)).toEqual(["two", "three"]);
    const older = await (await get(t.as(owner), groupId, `?before=${third.cursor}`)).json();
    expect(older.messages.map((m: { body: string }) => m.body)).toEqual(["one", "two"]);
    expect(older.cursor).toBeNull();
  });

  it("answers a stranger, a removed member, an unknown group and a malformed id with the same bare 404", async () => {
    const t = world();
    const owner = t.person("Asha");
    const stranger = t.person("Mina");
    const removed = t.person("Gone");
    const groupId = await t.makeGroup(owner);
    await t.groups.addMember(groupId, removed.id);
    const { message } = await send(t, owner, groupId, "private");
    await t.groups.removeMember(groupId, removed.id);

    const attempts: [string, Person][] = [
      [groupId, stranger],
      [groupId, removed],
      [crypto.randomUUID(), owner],
      ["not-a-uuid", owner],
    ];
    for (const [id, who] of attempts) {
      for (const query of ["", `?after=${message.cursor}`, `?before=${message.cursor}`]) {
        const response = await get(t.as(who), id, query);
        expect(response.status).toBe(404);
        expect(await response.text()).toBe("Not found");
        expect(response.headers.get("Cache-Control")).toBe("no-store");
      }
    }
  });

  it("does not let the signed-in person's redirect be swallowed: a signed-out visitor is sent on by requireChatDeps", async () => {
    const t = world();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    requireChatDeps.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(serveMessages(Promise.resolve({ id: groupId }), { nextUrl: new URL("https://app.test/x") } as never)).rejects.toThrow(
      "NEXT_REDIRECT",
    );
  });

  it("refuses a cursor that is repeated, too long, oddly shaped, empty, or given with the other one: 400, for everyone", async () => {
    const t = world();
    const owner = t.person("Asha");
    const stranger = t.person("Mina");
    const groupId = await t.makeGroup(owner);
    const { message } = await send(t, owner, groupId, "hi");
    const bad = [
      "?after=a&after=b",
      "?before=a&before=b",
      `?after=${"a".repeat(101)}`,
      "?after=has%20space",
      "?after=%00",
      "?after=a%2Fb",
      "?after=",
      "?before=",
      `?after=${message.cursor}&before=${message.cursor}`,
    ];
    for (const query of bad) {
      for (const who of [owner, stranger]) {
        const response = await get(t.as(who), groupId, query);
        expect(response.status).toBe(400);
        expect(response.headers.get("Cache-Control")).toBe("no-store");
        expect(await response.text()).toBe("Bad request");
      }
    }
  });

  it("accepts a cursor of exactly 100 characters, and unknown parameters are ignored", async () => {
    const t = world();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    await send(t, owner, groupId, "hi");
    expect((await get(t.as(owner), groupId, `?after=${"a".repeat(100)}`)).status).toBe(200);
    expect((await get(t.as(owner), groupId, "?x=1&limit=1000")).status).toBe(200);
  });

  it("a store outage is a 503 with a fixed text and a fixed log line, never a 404", async () => {
    const t = world();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    const deps = t.as(owner);
    deps.messages = { ...t.messages, listLatest: async () => Promise.reject(new Error("db down at secret-host")) };
    const response = await get(deps, groupId);
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Retry-After")).toBe("5");
    expect(await response.text()).not.toContain("secret-host");
    expect(vi.mocked(console.error).mock.calls).toEqual([["Could not load the chat."]]);
  });
});
