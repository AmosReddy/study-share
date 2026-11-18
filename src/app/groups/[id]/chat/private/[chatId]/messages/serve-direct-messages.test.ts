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
import { privateUnread, type DirectChatDeps } from "@/server/chat/direct-use-cases";
import { newGroupCode, newInviteToken } from "@/server/groups/secrets";
import { serveDirectMessages } from "./serve-direct-messages";

type Person = { id: string; displayName: string };

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
  const as = (user: Person): DirectChatDeps => ({ groups, limiter, siteUrl: "https://app.test", ip: "10.0.0.1", user, direct, secret: "test-secret" });
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
  return { groups, direct, person, as, makeGroup };
}

/** A group with the owner (Asha), two members who share a private chat (Ravi, Mina), an outsider and a removed member. */
async function crowd() {
  const t = world();
  const asha = t.person("Asha");
  const ravi = t.person("Ravi");
  const mina = t.person("Mina");
  const zed = t.person("Zed");
  const gone = t.person("Gone");
  const groupId = await t.makeGroup(asha);
  for (const who of [ravi, mina, gone]) await t.groups.addMember(groupId, who.id);
  await t.groups.removeMember(groupId, gone.id);
  const { chatId } = await t.direct.openChat(groupId, ravi.id, mina.id);
  return { t, asha, ravi, mina, zed, gone, groupId, chatId };
}

/** Calls the handler as `deps.user`, for an address like "?after=abc". */
function get(deps: DirectChatDeps, groupId: string, chatId: string, query = "") {
  requireDirectChatDeps.mockResolvedValue(deps);
  const url = new URL(`https://app.test/groups/${groupId}/chat/private/${chatId}/messages${query}`);
  return serveDirectMessages(Promise.resolve({ id: groupId, chatId }), { nextUrl: url } as never);
}

const send = (t: ReturnType<typeof world>, who: Person, chatId: string, body: string) =>
  t.direct.send({ chatId, senderId: who.id, clientId: crypto.randomUUID(), body });

beforeEach(() => {
  connection.mockClear();
  requireDirectChatDeps.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /groups/[id]/chat/private/[chatId]/messages", () => {
  it("waits for a real request first, then answers JSON with no-store, who it is with and whether the person may reply", async () => {
    const { t, ravi, mina, groupId, chatId } = await crowd();
    await send(t, ravi, chatId, "hello");
    const response = await get(t.as(mina), groupId, chatId);
    expect(connection).toHaveBeenCalledTimes(1);
    expect(connection.mock.invocationCallOrder[0]).toBeLessThan(requireDirectChatDeps.mock.invocationCallOrder[0]);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Type")).toMatch(/application\/json/);
    const body = await response.json();
    expect(body).toMatchObject({
      hasMore: false,
      canSend: true,
      otherName: "Ravi",
      otherGone: false,
      messages: [{ body: "hello", senderName: "Ravi", mine: false, canDelete: false }],
    });
    expect(JSON.stringify(body)).not.toContain(ravi.id);
    expect(JSON.stringify(body)).not.toContain(mina.id);
    expect(body).not.toHaveProperty("canDeleteAny");
  });

  it("returns newer messages for ?after and an earlier page for ?before", async () => {
    const { t, ravi, mina, groupId, chatId } = await crowd();
    const first = (await send(t, ravi, chatId, "one")).message;
    await send(t, mina, chatId, "two");
    const third = (await send(t, ravi, chatId, "three")).message;

    const news = await (await get(t.as(mina), groupId, chatId, `?after=${first.cursor}`)).json();
    expect(news.messages.map((m: { body: string }) => m.body)).toEqual(["two", "three"]);
    const older = await (await get(t.as(mina), groupId, chatId, `?before=${third.cursor}`)).json();
    expect(older.messages.map((m: { body: string }) => m.body)).toEqual(["one", "two"]);
    expect(older.cursor).toBeNull();
  });

  it("a poll that shows the newest messages clears the person's unread dot", async () => {
    const { t, ravi, mina, groupId, chatId } = await crowd();
    await send(t, ravi, chatId, "hello");
    expect((await privateUnread(t.as(mina), groupId)).any).toBe(true);
    await get(t.as(mina), groupId, chatId);
    expect((await privateUnread(t.as(mina), groupId)).any).toBe(false);
  });

  it("answers the owner who is not in the chat, a stranger, a removed member, another group's address, an unknown group and malformed ids with the same bare 404", async () => {
    const { t, asha, ravi, mina, zed, gone, groupId, chatId } = await crowd();
    const { message } = await send(t, ravi, chatId, "private");
    const otherGroup = await t.makeGroup(zed);
    const unrelated = await t.direct.openChat(groupId, asha.id, mina.id);

    const attempts: [string, string, Person][] = [
      [groupId, chatId, asha], // the group's owner
      [groupId, chatId, zed], // a stranger
      [groupId, chatId, gone], // a removed member
      [otherGroup, chatId, zed], // the chat id under another group's address, by that group's owner
      [crypto.randomUUID(), chatId, ravi],
      ["not-a-uuid", chatId, ravi],
      [groupId, crypto.randomUUID(), ravi],
      [groupId, "not-a-uuid", ravi],
      [groupId, unrelated.chatId, ravi], // a chat of someone else's, in the same group
    ];
    for (const [id, chat, who] of attempts) {
      for (const query of ["", `?after=${message.cursor}`, `?before=${message.cursor}`]) {
        const response = await get(t.as(who), id, chat, query);
        expect(response.status).toBe(404);
        expect(await response.text()).toBe("Not found");
        expect(response.headers.get("Cache-Control")).toBe("no-store");
      }
    }
    // The chat's own people are not affected, and the owner's tries did not move anyone's read position.
    expect((await get(t.as(mina), groupId, chatId)).status).toBe(200);
  });

  it("a chat id of another group under this group's address is a 404 even for a participant who is in both groups", async () => {
    const { t, asha, ravi, mina, groupId, chatId } = await crowd();
    const groupB = await t.makeGroup(asha);
    await t.groups.addMember(groupB, ravi.id);
    await t.groups.addMember(groupB, mina.id);
    expect((await get(t.as(ravi), groupB, chatId)).status).toBe(404);
    expect((await get(t.as(ravi), groupId, chatId)).status).toBe(200);
  });

  it("a person who is removed while the page is open stops getting messages at the next poll, and the stayer reads on", async () => {
    const { t, ravi, mina, groupId, chatId } = await crowd();
    const { message } = await send(t, ravi, chatId, "one");
    expect((await get(t.as(ravi), groupId, chatId, `?after=${message.cursor}`)).status).toBe(200);
    await t.groups.removeMember(groupId, ravi.id);
    expect((await get(t.as(ravi), groupId, chatId, `?after=${message.cursor}`)).status).toBe(404);
    const stayer = await (await get(t.as(mina), groupId, chatId)).json();
    expect(stayer).toMatchObject({ canSend: false, otherGone: true, otherName: "Ravi" });
  });

  it("does not let the signed-in person's redirect be swallowed: a signed-out visitor is sent on by requireDirectChatDeps", async () => {
    const { groupId, chatId } = await crowd();
    requireDirectChatDeps.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(
      serveDirectMessages(Promise.resolve({ id: groupId, chatId }), { nextUrl: new URL("https://app.test/x") } as never),
    ).rejects.toThrow("NEXT_REDIRECT");
  });

  it("refuses a cursor that is repeated, too long, oddly shaped, empty, or given with the other one: 400, for everyone", async () => {
    const { t, ravi, zed, groupId, chatId } = await crowd();
    const { message } = await send(t, ravi, chatId, "hi");
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
      for (const who of [ravi, zed]) {
        const response = await get(t.as(who), groupId, chatId, query);
        expect(response.status).toBe(400);
        expect(response.headers.get("Cache-Control")).toBe("no-store");
        expect(await response.text()).toBe("Bad request");
      }
    }
  });

  it("accepts a cursor of exactly 100 characters, and unknown parameters are ignored", async () => {
    const { t, ravi, groupId, chatId } = await crowd();
    await send(t, ravi, chatId, "hi");
    expect((await get(t.as(ravi), groupId, chatId, `?after=${"a".repeat(100)}`)).status).toBe(200);
    expect((await get(t.as(ravi), groupId, chatId, "?x=1&limit=1000")).status).toBe(200);
  });

  it("a store outage is a 503 with a fixed text and a fixed log line, never a 404", async () => {
    const { t, mina, groupId, chatId } = await crowd();
    const deps = t.as(mina);
    deps.direct = { ...t.direct, listLatest: async () => Promise.reject(new Error("db down at secret-host")) };
    const response = await get(deps, groupId, chatId);
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Retry-After")).toBe("5");
    expect(await response.text()).not.toContain("secret-host");
    expect(vi.mocked(console.error).mock.calls).toEqual([["Could not load the private chat."]]);
  });
});
