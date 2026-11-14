import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeAuthStore } from "@/server/adapters/fake-auth-provider";
import { createFakeGroupStore, resetFakeGroupStore } from "@/server/adapters/fake-group-store";
import { createFakeMessageStore, resetFakeMessageStore } from "@/server/adapters/fake-message-store";
import { createMemoryRateLimiter } from "@/server/adapters/memory-rate-limiter";
import { newGroupCode, newInviteToken } from "@/server/groups/secrets";
import type { MessageStore } from "@/server/ports/message-store";
import { CHAT_MESSAGES } from "@/shared/chat-messages";
import { CHAT_LIMITS } from "@/shared/messages";
import { deleteMessage, loadChat, sendMessage, type ChatDeps, type MessageView } from "./use-cases";

const SITE = "https://app.test";
const MISSING_ID = "99999999-9999-4999-8999-999999999999";
const NOT_FOUND = { ok: false, notFound: true, formError: CHAT_MESSAGES.notFound };

type Person = { id: string; displayName: string };

/** Everything on a test clock, over the fake stores; `as(person)` gives that person's deps. */
function setup() {
  resetFakeGroupStore();
  resetFakeMessageStore();
  const auth = createFakeAuthStore();
  const groups = createFakeGroupStore(auth);
  const messages = createFakeMessageStore(auth);
  let now = Date.now();
  const limiter = createMemoryRateLimiter(() => now);
  const advance = (seconds: number) => void (now += seconds * 1000);

  const person = (displayName: string): Person => {
    const id = crypto.randomUUID();
    auth.users.set(id, {
      id,
      email: `${id}@example.test`,
      password: null,
      displayName,
      termsVersion: null,
      confirmed: true,
      identities: [],
    });
    return { id, displayName };
  };
  const as = (user: Person): ChatDeps => ({ groups, limiter, siteUrl: SITE, ip: "10.0.0.1", user, messages });
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
  return { auth, groups, messages, limiter, advance, person, as, makeGroup };
}

const say = (body: string, clientId: string = crypto.randomUUID()) => ({ body, clientId });

/** Sends and expects success; returns the view. */
async function sent(deps: ChatDeps, groupId: string, body: string, clientId?: string): Promise<MessageView> {
  const result = await sendMessage(deps, groupId, say(body, clientId));
  if (!result.ok) throw new Error(`sendMessage refused: ${JSON.stringify(result)}`);
  return result.data;
}

async function chat(deps: ChatDeps, groupId: string, query = {}) {
  const page = await loadChat(deps, groupId, query);
  if (!page) throw new Error("the chat was not readable");
  return page;
}

const bodies = (views: MessageView[]) => views.map((m) => m.body);

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("who may use the chat of a group", () => {
  it("answers a stranger, a removed member, an unknown group and a malformed id exactly like a missing message", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const member = t.person("Ravi");
    const stranger = t.person("Mina");
    const removed = t.person("Gone");
    const groupId = await t.makeGroup(owner);
    await t.groups.addMember(groupId, member.id);
    await t.groups.addMember(groupId, removed.id);
    const message = await sent(t.as(member), groupId, "hello");
    await t.groups.removeMember(groupId, removed.id);

    const otherGroup = await t.makeGroup(t.person("Someone else"));
    const attempts: [string, Person][] = [
      [groupId, stranger],
      [groupId, removed],
      [crypto.randomUUID(), owner],
      ["not-a-uuid", owner],
      [otherGroup, owner], // the owner of ANOTHER group, asking for this group's message id
    ];
    for (const [id, who] of attempts) {
      const deps = t.as(who);
      expect(await sendMessage(deps, id, say("let me in"))).toEqual(NOT_FOUND);
      expect(await deleteMessage(deps, id, message.id)).toEqual(NOT_FOUND);
      expect(await loadChat(deps, id)).toBeNull();
      expect(await loadChat(deps, id, { after: message.cursor })).toBeNull();
      expect(await loadChat(deps, id, { before: message.cursor })).toBeNull();
    }
    // Nothing changed: the chat is as it was.
    expect(bodies((await chat(t.as(member), groupId)).messages)).toEqual(["hello"]);
  });

  it("a removed member who sent messages can no longer read, send or delete them", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const member = t.person("Ravi");
    const groupId = await t.makeGroup(owner);
    await t.groups.addMember(groupId, member.id);
    const message = await sent(t.as(member), groupId, "mine");
    await t.groups.removeMember(groupId, member.id);
    expect(await deleteMessage(t.as(member), groupId, message.id)).toEqual(NOT_FOUND);
    expect(await sendMessage(t.as(member), groupId, say("again"))).toEqual(NOT_FOUND);
    expect(await loadChat(t.as(member), groupId)).toBeNull();
    expect(bodies((await chat(t.as(owner), groupId)).messages)).toEqual(["mine"]);
  });

  it("a member who left cannot use the chat either", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const member = t.person("Ravi");
    const groupId = await t.makeGroup(owner);
    await t.groups.addMember(groupId, member.id);
    await t.groups.leave(groupId, member.id);
    expect(await sendMessage(t.as(member), groupId, say("hi"))).toEqual(NOT_FOUND);
    expect(await loadChat(t.as(member), groupId)).toBeNull();
  });

  it("never touches a message under another group's address, even for a member of that group (IDOR)", async () => {
    const t = setup();
    const ownerA = t.person("Asha");
    const ownerB = t.person("Bea");
    const groupA = await t.makeGroup(ownerA);
    const groupB = await t.makeGroup(ownerB);
    const messageA = await sent(t.as(ownerA), groupA, "secret of A");
    await sent(t.as(ownerB), groupB, "hello B");

    // Bea is the OWNER of group B and so would be allowed to delete any message there: she asks
    // for group A's message id under group B's address.
    expect(await deleteMessage(t.as(ownerB), groupB, messageA.id)).toEqual(NOT_FOUND);
    // The answer is the one a made-up id gets.
    expect(await deleteMessage(t.as(ownerB), groupB, MISSING_ID)).toEqual(await deleteMessage(t.as(ownerB), groupB, messageA.id));

    // Same for a plain member of B whose own message id is used under A's address, and a member
    // of both groups using the wrong address.
    const member = t.person("Cy");
    await t.groups.addMember(groupB, member.id);
    await t.groups.addMember(groupA, member.id);
    const memberB = await sent(t.as(member), groupB, "Cy in B");
    expect(await deleteMessage(t.as(member), groupA, memberB.id)).toEqual(NOT_FOUND);
    expect(await deleteMessage(t.as(member), groupB, messageA.id)).toEqual(NOT_FOUND);

    // Nothing was deleted, and the chats did not mix.
    expect(bodies((await chat(t.as(ownerA), groupA)).messages)).toEqual(["secret of A"]);
    expect(bodies((await chat(t.as(ownerB), groupB)).messages)).toEqual(["hello B", "Cy in B"]);
    // A's cursor under B's address is only a position: nothing of A shows up.
    const polled = await chat(t.as(ownerB), groupB, { after: messageA.cursor });
    expect(JSON.stringify(polled)).not.toContain("secret of A");
    const earlier = await chat(t.as(ownerB), groupB, { before: messageA.cursor });
    expect(JSON.stringify(earlier)).not.toContain("secret of A");
  });

  it("answers a deleted group like a missing one", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    const message = await sent(t.as(owner), groupId, "hi");
    await t.groups.softDeleteGroup(groupId);
    expect(await loadChat(t.as(owner), groupId)).toBeNull();
    expect(await sendMessage(t.as(owner), groupId, say("hello?"))).toEqual(NOT_FOUND);
    expect(await deleteMessage(t.as(owner), groupId, message.id)).toEqual(NOT_FOUND);
  });

  it("a store failure while checking the group is a failure on actions and an error on reads, never 'not found'", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    const deps = t.as(owner);
    deps.groups = { ...deps.groups, findById: async () => Promise.reject(new Error("db down at groups/secret-key")) };
    const failed = { ok: false, formError: CHAT_MESSAGES.couldNotSave };
    expect(await sendMessage(deps, groupId, say("hi"))).toEqual(failed);
    expect(await deleteMessage(deps, groupId, MISSING_ID)).toEqual(failed);
    await expect(loadChat(deps, groupId)).rejects.toThrow();
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("secret-key");
  });
});

describe("sendMessage", () => {
  it("saves a message and returns a client-safe view", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    const clientId = crypto.randomUUID();
    const result = await sendMessage(t.as(owner), groupId, { body: "hello", clientId });
    expect(result).toEqual({
      ok: true,
      data: {
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        clientId,
        body: "hello",
        senderName: "Asha",
        mine: true,
        canDelete: true,
        createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
        cursor: expect.any(String),
      },
    });
    // The view never has an account id, under any name.
    expect(JSON.stringify(result)).not.toContain(owner.id);
    expect(Object.keys(result.ok ? result.data : {}).sort()).toEqual(
      ["body", "canDelete", "clientId", "createdAt", "cursor", "id", "mine", "senderName"].sort(),
    );
  });

  it("lets members and the owner send", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const member = t.person("Ravi");
    const groupId = await t.makeGroup(owner);
    await t.groups.addMember(groupId, member.id);
    expect((await sendMessage(t.as(member), groupId, say("from a member"))).ok).toBe(true);
    expect((await sendMessage(t.as(owner), groupId, say("from the owner"))).ok).toBe(true);
  });

  it("trims the text, turns line breaks into one kind, and drops control characters but keeps what is inside", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    const deps = t.as(owner);
    expect((await sent(deps, groupId, "   hello  \n  ")).body).toBe("hello");
    expect((await sent(deps, groupId, "a\r\nb\rc\nd")).body).toBe("a\nb\nc\nd");
    expect((await sent(deps, groupId, "one\n\n\ntwo   three")).body).toBe("one\n\n\ntwo   three");
    expect((await sent(deps, groupId, "no\u0000ul\u0007bell\u001b[0m")).body).toBe("noulbell[0m");
    expect((await sent(deps, groupId, "tab\there")).body).toBe("tab here");
    expect((await sent(deps, groupId, "<script>alert(1)</script> & नमस्ते \u{1F600}")).body).toBe(
      "<script>alert(1)</script> & नमस्ते \u{1F600}",
    );
  });

  it("refuses an empty message, or one with only spaces, line breaks or control characters", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    for (const body of ["", "   ", "\n\n", " \t \r\n ", "\u0000", "\u0000 \u0001"]) {
      expect(await sendMessage(t.as(owner), groupId, say(body))).toEqual({
        ok: false,
        fieldErrors: { body: CHAT_MESSAGES.bodyRequired },
      });
    }
    expect((await chat(t.as(owner), groupId)).messages).toEqual([]);
  });

  it("allows exactly 2000 characters, counting what people see, and refuses 2001", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    const deps = t.as(owner);
    expect((await sendMessage(deps, groupId, say("x".repeat(CHAT_LIMITS.maxBody)))).ok).toBe(true);
    expect((await sendMessage(deps, groupId, say("\u{1F600}".repeat(CHAT_LIMITS.maxBody)))).ok).toBe(true);
    const tooLong = { ok: false, fieldErrors: { body: CHAT_MESSAGES.bodyTooLong } };
    expect(await sendMessage(deps, groupId, say("x".repeat(CHAT_LIMITS.maxBody + 1)))).toEqual(tooLong);
    expect(await sendMessage(deps, groupId, say("\u{1F600}".repeat(CHAT_LIMITS.maxBody + 1)))).toEqual(tooLong);
    // Spaces around the text do not count, and neither do control characters taken out.
    expect((await sendMessage(deps, groupId, say(`  ${"x".repeat(CHAT_LIMITS.maxBody)}  `))).ok).toBe(true);
    expect((await sendMessage(deps, groupId, say(`${"x".repeat(CHAT_LIMITS.maxBody)}\u0000\u0000`))).ok).toBe(true);
    // A huge body is refused without being processed.
    expect(await sendMessage(deps, groupId, say("x".repeat(1_000_000)))).toEqual(tooLong);
  });

  it("refuses a bad client id, a missing field and a form that is not an object", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    const deps = t.as(owner);
    for (const clientId of ["", "abc", "1234", crypto.randomUUID() + "x", 5, null, undefined]) {
      expect(await sendMessage(deps, groupId, { body: "hi", clientId })).toEqual({
        ok: false,
        fieldErrors: { clientId: CHAT_MESSAGES.badForm },
      });
    }
    expect(await sendMessage(deps, groupId, { clientId: crypto.randomUUID() })).toMatchObject({ ok: false, fieldErrors: { body: expect.any(String) } });
    expect(await sendMessage(deps, groupId, { body: 5, clientId: crypto.randomUUID() })).toMatchObject({ ok: false, fieldErrors: { body: expect.any(String) } });
    expect(await sendMessage(deps, groupId, null)).toEqual({ ok: false, formError: CHAT_MESSAGES.badForm });
    expect(await sendMessage(deps, groupId, "hello")).toEqual({ ok: false, formError: CHAT_MESSAGES.badForm });
    expect((await chat(deps, groupId)).messages).toEqual([]);
  });

  it("ignores extra fields, so a sender or a time cannot be forged", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const other = t.person("Ravi");
    const groupId = await t.makeGroup(owner);
    await t.groups.addMember(groupId, other.id);
    const result = await sendMessage(t.as(owner), groupId, {
      ...say("hi"),
      senderId: other.id,
      groupId: crypto.randomUUID(),
      createdAt: "2001-01-01T00:00:00Z",
    });
    expect(result).toMatchObject({ ok: true, data: { senderName: "Asha", mine: true } });
    expect(result.ok && result.data.createdAt.startsWith("2001")).toBe(false);
  });

  it("accepts the client id in any letter case and keeps it lower-case", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    const id = crypto.randomUUID();
    const first = await sent(t.as(owner), groupId, "once", id.toUpperCase());
    expect(first.clientId).toBe(id);
    const again = await sent(t.as(owner), groupId, "once", id);
    expect(again.id).toBe(first.id);
  });

  it("is safe to repeat: the same client id answers with the first message and saves nothing new", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    const clientId = crypto.randomUUID();
    const first = await sent(t.as(owner), groupId, "once", clientId);
    const again = await sent(t.as(owner), groupId, "once", clientId);
    expect(again).toEqual(first);
    // Even with other text: the first message stands.
    expect(await sent(t.as(owner), groupId, "changed", clientId)).toEqual(first);
    expect(bodies((await chat(t.as(owner), groupId)).messages)).toEqual(["once"]);
  });

  it("refuses a client id that already belongs to another person's message, without showing it", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const member = t.person("Ravi");
    const groupId = await t.makeGroup(owner);
    await t.groups.addMember(groupId, member.id);
    const clientId = crypto.randomUUID();
    await sent(t.as(owner), groupId, "Asha's secret plan", clientId);
    const result = await sendMessage(t.as(member), groupId, say("trying", clientId));
    expect(result).toEqual({ ok: false, formError: CHAT_MESSAGES.couldNotSave });
    expect(JSON.stringify(result)).not.toContain("secret plan");
    expect(bodies((await chat(t.as(owner), groupId)).messages)).toEqual(["Asha's secret plan"]);
  });

  it("a retry of a message that was deleted meanwhile says so and does not bring it back", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const member = t.person("Ravi");
    const groupId = await t.makeGroup(owner);
    await t.groups.addMember(groupId, member.id);
    const clientId = crypto.randomUUID();
    const first = await sent(t.as(member), groupId, "oops", clientId);
    expect(await deleteMessage(t.as(owner), groupId, first.id)).toEqual({ ok: true, data: undefined });
    expect(await sendMessage(t.as(member), groupId, say("oops", clientId))).toEqual({
      ok: false,
      formError: CHAT_MESSAGES.messageRemoved,
    });
    expect((await chat(t.as(owner), groupId)).messages).toEqual([]);
  });

  it("allows 20 a minute for a person, then refuses with the too-many message until the minute is up", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const other = t.person("Ravi");
    const groupId = await t.makeGroup(owner);
    await t.groups.addMember(groupId, other.id);
    for (let i = 0; i < 20; i++) expect((await sendMessage(t.as(owner), groupId, say(`m${i}`))).ok).toBe(true);
    const refused = await sendMessage(t.as(owner), groupId, say("one too many"));
    expect(refused).toMatchObject({ ok: false, formError: CHAT_MESSAGES.tooMany, retryAfterSeconds: expect.any(Number) });
    expect(bodies((await chat(t.as(owner), groupId)).messages)).not.toContain("one too many");
    // Another person has their own budget.
    expect((await sendMessage(t.as(other), groupId, say("fine"))).ok).toBe(true);
    t.advance(61);
    expect((await sendMessage(t.as(owner), groupId, say("fine again"))).ok).toBe(true);
  });

  it("the budget is per person, not per group", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const first = await t.makeGroup(owner);
    const second = await t.makeGroup(owner);
    for (let i = 0; i < 20; i++) await sendMessage(t.as(owner), first, say(`m${i}`));
    expect(await sendMessage(t.as(owner), second, say("elsewhere"))).toMatchObject({ ok: false, formError: CHAT_MESSAGES.tooMany });
  });

  it("a bad form does not use up the budget", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    for (let i = 0; i < 40; i++) await sendMessage(t.as(owner), groupId, say(""));
    expect((await sendMessage(t.as(owner), groupId, say("hi"))).ok).toBe(true);
  });

  it("a stranger's attempts do not use up anything", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const stranger = t.person("Mina");
    const groupId = await t.makeGroup(owner);
    for (let i = 0; i < 30; i++) expect(await sendMessage(t.as(stranger), groupId, say("hi"))).toEqual(NOT_FOUND);
    const peek = await t.limiter.peek({ key: `chat-send:user:${stranger.id}`, limit: 20, windowSeconds: 60 });
    expect(peek.allowed).toBe(true);
  });

  it("lets the message through when the limiter is down", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    const deps = t.as(owner);
    deps.limiter = { hit: () => Promise.reject(new Error("db down")), peek: () => Promise.reject(new Error("db down")) } as never;
    expect((await sendMessage(deps, groupId, say("hi"))).ok).toBe(true);
    expect(console.warn).toHaveBeenCalledWith("Rate limit store unavailable; allowing the request.");
  });

  it("when the message cannot be saved, answers generically, without the error's text", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    const deps = t.as(owner);
    deps.messages = { ...t.messages, send: async () => Promise.reject(new Error("deadlock on messages_pkey group=abc")) };
    const result = await sendMessage(deps, groupId, say("hi"));
    expect(result).toEqual({ ok: false, formError: CHAT_MESSAGES.couldNotSave });
    expect(JSON.stringify(result)).not.toContain("deadlock");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toMatch(/deadlock|messages_pkey|abc/);
  });
});

describe("loadChat", () => {
  it("returns the latest messages oldest first, with who sent them and what the caller may do", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const member = t.person("Ravi");
    const groupId = await t.makeGroup(owner);
    await t.groups.addMember(groupId, member.id);
    await sent(t.as(owner), groupId, "first");
    await sent(t.as(member), groupId, "second");

    const asMember = await chat(t.as(member), groupId);
    expect(asMember.messages.map((m) => [m.body, m.senderName, m.mine, m.canDelete])).toEqual([
      ["first", "Asha", false, false],
      ["second", "Ravi", true, true],
    ]);
    expect(asMember.canDeleteAny).toBe(false);
    expect(asMember.hasMore).toBe(false);
    expect(asMember.cursor).toBe(asMember.messages[1].cursor);

    const asOwner = await chat(t.as(owner), groupId);
    expect(asOwner.messages.map((m) => [m.mine, m.canDelete])).toEqual([
      [true, true],
      [false, true],
    ]);
    expect(asOwner.canDeleteAny).toBe(true);
  });

  it("never includes an account id, in any form", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const member = t.person("Ravi");
    const groupId = await t.makeGroup(owner);
    await t.groups.addMember(groupId, member.id);
    await sent(t.as(owner), groupId, "a");
    await sent(t.as(member), groupId, "b");
    const page = await chat(t.as(member), groupId);
    const text = JSON.stringify(page);
    expect(text).not.toContain(owner.id);
    expect(text).not.toContain(member.id);
    expect(text).not.toContain(groupId);
    for (const m of page.messages) {
      expect(Object.keys(m).sort()).toEqual(["body", "canDelete", "clientId", "createdAt", "cursor", "id", "mine", "senderName"]);
    }
  });

  it("an empty chat is an empty page with no cursor", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    expect(await chat(t.as(owner), groupId)).toEqual({ messages: [], hasMore: false, cursor: null, canDeleteAny: true });
  });

  it("with no query gives the latest 50 and says there are older ones", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    // Straight into the store: sending 60 would run into the rate limit.
    for (let n = 1; n <= 60; n++) {
      await t.messages.send({ groupId, senderId: owner.id, clientId: crypto.randomUUID(), body: `m${n}` });
    }
    const page = await chat(t.as(owner), groupId);
    expect(page.messages).toHaveLength(CHAT_LIMITS.pageSize);
    expect(page.messages[0].body).toBe("m11");
    expect(page.messages[49].body).toBe("m60");
    expect(page.hasMore).toBe(true);
    expect(page.cursor).toBe(page.messages[49].cursor);

    const older = await chat(t.as(owner), groupId, { before: page.messages[0].cursor });
    expect(bodies(older.messages)).toEqual(Array.from({ length: 10 }, (_, i) => `m${i + 1}`));
    expect(older.hasMore).toBe(false);
  });

  it("'before' loads the earlier page and does not move the place polling starts from", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    for (let n = 1; n <= 55; n++) {
      await t.messages.send({ groupId, senderId: owner.id, clientId: crypto.randomUUID(), body: `m${n}` });
    }
    const latest = await chat(t.as(owner), groupId);
    const older = await chat(t.as(owner), groupId, { before: latest.messages[0].cursor });
    expect(bodies(older.messages)).toEqual(["m1", "m2", "m3", "m4", "m5"]);
    expect(older.hasMore).toBe(false);
    expect(older.cursor).toBeNull();
  });

  it("'after' returns only newer messages, and the cursor moves to the newest", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const member = t.person("Ravi");
    const groupId = await t.makeGroup(owner);
    await t.groups.addMember(groupId, member.id);
    await sent(t.as(owner), groupId, "one");
    const start = await chat(t.as(member), groupId);

    const nothing = await chat(t.as(member), groupId, { after: start.cursor! });
    expect(nothing).toEqual({ messages: [], hasMore: false, cursor: start.cursor, canDeleteAny: false });

    await sent(t.as(owner), groupId, "two");
    await sent(t.as(owner), groupId, "three");
    const news = await chat(t.as(member), groupId, { after: start.cursor! });
    expect(bodies(news.messages)).toEqual(["two", "three"]);
    expect(news.hasMore).toBe(false);
    expect(news.cursor).toBe(news.messages[1].cursor);
    expect((await chat(t.as(member), groupId, { after: news.cursor! })).messages).toEqual([]);
  });

  it("'after' with more than a page waiting says there is more, and the cursor lets the next poll continue", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    const first = await sent(t.as(owner), groupId, "start");
    for (let n = 1; n <= 55; n++) {
      await t.messages.send({ groupId, senderId: owner.id, clientId: crypto.randomUUID(), body: `n${n}` });
    }
    const a = await chat(t.as(owner), groupId, { after: first.cursor });
    expect(a.messages).toHaveLength(50);
    expect(a.messages[0].body).toBe("n1");
    expect(a.hasMore).toBe(true);
    const b = await chat(t.as(owner), groupId, { after: a.cursor! });
    expect(bodies(b.messages)).toEqual(["n51", "n52", "n53", "n54", "n55"]);
    expect(b.hasMore).toBe(false);
  });

  it("a message sent by the poller's own person between polls shows up once", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    const mine = await sent(t.as(owner), groupId, "mine");
    const mineAgain = await sent(t.as(owner), groupId, "mine", mine.clientId);
    expect(mineAgain.id).toBe(mine.id);
    const polled = await chat(t.as(owner), groupId, { after: "" });
    expect(polled.messages).toHaveLength(1);
  });

  it("a cursor that is not a cursor gives the latest page, for after and before alike", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    await sent(t.as(owner), groupId, "one");
    await sent(t.as(owner), groupId, "two");
    const latest = await chat(t.as(owner), groupId);
    for (const bad of ["garbage", "!!!", "x".repeat(500), "%00", "12:nope"]) {
      expect(await chat(t.as(owner), groupId, { after: bad })).toEqual(latest);
      expect((await chat(t.as(owner), groupId, { before: bad })).messages).toEqual(latest.messages);
    }
  });

  it("a bad 'after' on an empty chat does not echo the bad text back as a cursor", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    expect((await chat(t.as(owner), groupId, { after: "<script>alert(1)</script>" })).cursor).toBeNull();
  });

  it("ignores query values that are not text, and an empty value, and prefers 'after' when both are given", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    const one = await sent(t.as(owner), groupId, "one");
    await sent(t.as(owner), groupId, "two");
    const latest = await chat(t.as(owner), groupId);
    expect(await chat(t.as(owner), groupId, { after: 5 as never, before: ["x"] as never })).toEqual(latest);
    expect(await chat(t.as(owner), groupId, { after: "", before: "" })).toEqual(latest);
    const both = await chat(t.as(owner), groupId, { after: one.cursor, before: one.cursor });
    expect(bodies(both.messages)).toEqual(["two"]);
  });

  it("shows 'Former member' when the sender's account is gone, with no name or id", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const leaver = t.person("Leaver");
    const groupId = await t.makeGroup(owner);
    await t.groups.addMember(groupId, leaver.id);
    await sent(t.as(leaver), groupId, "I was here");
    t.auth.users.delete(leaver.id);
    const page = await chat(t.as(owner), groupId);
    expect(page.messages[0]).toMatchObject({
      body: "I was here",
      senderName: CHAT_MESSAGES.formerMember,
      mine: false,
      canDelete: true,
    });
    expect(JSON.stringify(page)).not.toMatch(/Leaver/);
    expect(JSON.stringify(page)).not.toContain(leaver.id);
  });

  it("shows 'Former member' for a sender whose name is blank", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const blank = t.person("   ");
    const groupId = await t.makeGroup(owner);
    await t.groups.addMember(groupId, blank.id);
    await sent(t.as(blank), groupId, "hi");
    expect((await chat(t.as(owner), groupId)).messages[0].senderName).toBe(CHAT_MESSAGES.formerMember);
  });

  it("does not show deleted messages", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    const gone = await sent(t.as(owner), groupId, "gone");
    await sent(t.as(owner), groupId, "kept");
    await deleteMessage(t.as(owner), groupId, gone.id);
    expect(bodies((await chat(t.as(owner), groupId)).messages)).toEqual(["kept"]);
    expect(bodies((await chat(t.as(owner), groupId, { after: gone.cursor })).messages)).toEqual(["kept"]);
  });

  it("a store failure throws, with no text of the error leaked", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    const deps = t.as(owner);
    deps.messages = { ...t.messages, listLatest: async () => Promise.reject(new Error("boom")) };
    await expect(loadChat(deps, groupId)).rejects.toThrow();
  });
});

describe("deleteMessage", () => {
  it("lets the sender delete their own message", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const member = t.person("Ravi");
    const groupId = await t.makeGroup(owner);
    await t.groups.addMember(groupId, member.id);
    const keep = await sent(t.as(owner), groupId, "keep");
    const mine = await sent(t.as(member), groupId, "mine");
    expect(await deleteMessage(t.as(member), groupId, mine.id)).toEqual({ ok: true, data: undefined });
    expect(bodies((await chat(t.as(owner), groupId)).messages)).toEqual(["keep"]);
    expect(keep.id).not.toBe(mine.id);
  });

  it("lets the owner delete anyone's message, and their own", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const member = t.person("Ravi");
    const groupId = await t.makeGroup(owner);
    await t.groups.addMember(groupId, member.id);
    const theirs = await sent(t.as(member), groupId, "theirs");
    const ownerOwn = await sent(t.as(owner), groupId, "owner's");
    expect(await deleteMessage(t.as(owner), groupId, theirs.id)).toEqual({ ok: true, data: undefined });
    expect(await deleteMessage(t.as(owner), groupId, ownerOwn.id)).toEqual({ ok: true, data: undefined });
    expect((await chat(t.as(owner), groupId)).messages).toEqual([]);
  });

  it("does not let a member delete someone else's message: the answer is 'not found' and nothing changes", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const member = t.person("Ravi");
    const other = t.person("Mina");
    const groupId = await t.makeGroup(owner);
    await t.groups.addMember(groupId, member.id);
    await t.groups.addMember(groupId, other.id);
    const ownersMessage = await sent(t.as(owner), groupId, "owner's");
    const othersMessage = await sent(t.as(other), groupId, "Mina's");
    expect(await deleteMessage(t.as(member), groupId, ownersMessage.id)).toEqual(NOT_FOUND);
    expect(await deleteMessage(t.as(member), groupId, othersMessage.id)).toEqual(NOT_FOUND);
    // The same answer as for a message that does not exist.
    expect(await deleteMessage(t.as(member), groupId, MISSING_ID)).toEqual(NOT_FOUND);
    expect(bodies((await chat(t.as(owner), groupId)).messages)).toEqual(["owner's", "Mina's"]);
  });

  it("an unknown, malformed or already deleted id is 'not found'", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    const message = await sent(t.as(owner), groupId, "hi");
    for (const id of [MISSING_ID, "not-a-uuid", "", "' or 1=1 --", message.id + "0"]) {
      expect(await deleteMessage(t.as(owner), groupId, id)).toEqual(NOT_FOUND);
    }
    expect(await deleteMessage(t.as(owner), groupId, message.id)).toEqual({ ok: true, data: undefined });
    expect(await deleteMessage(t.as(owner), groupId, message.id)).toEqual(NOT_FOUND);
  });

  it("accepts the id in upper case", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    const message = await sent(t.as(owner), groupId, "hi");
    expect(await deleteMessage(t.as(owner), groupId, message.id.toUpperCase())).toEqual({ ok: true, data: undefined });
  });

  it("the sender of a message from a former account cannot be matched by anyone: only the owner deletes it", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const leaver = t.person("Leaver");
    const member = t.person("Ravi");
    const groupId = await t.makeGroup(owner);
    await t.groups.addMember(groupId, leaver.id);
    await t.groups.addMember(groupId, member.id);
    const message = await sent(t.as(leaver), groupId, "from the past");
    t.auth.users.delete(leaver.id);
    expect(await deleteMessage(t.as(member), groupId, message.id)).toEqual(NOT_FOUND);
    expect(await deleteMessage(t.as(owner), groupId, message.id)).toEqual({ ok: true, data: undefined });
  });

  it("a store failure leaves the message in place and answers with a failure", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    const message = await sent(t.as(owner), groupId, "hi");
    const deps = t.as(owner);
    deps.messages = { ...t.messages, softDelete: async () => Promise.reject(new Error("boom groups/secret")) };
    expect(await deleteMessage(deps, groupId, message.id)).toEqual({ ok: false, formError: CHAT_MESSAGES.couldNotSave });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("secret");
    expect(bodies((await chat(t.as(owner), groupId)).messages)).toEqual(["hi"]);

    const lookup: MessageStore = { ...t.messages, findById: async () => Promise.reject(new Error("boom")) };
    deps.messages = lookup;
    expect(await deleteMessage(deps, groupId, message.id)).toEqual({ ok: false, formError: CHAT_MESSAGES.couldNotSave });
  });

  it("a delete that loses a race to another delete answers 'not found'", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    const message = await sent(t.as(owner), groupId, "hi");
    const deps = t.as(owner);
    deps.messages = { ...t.messages, softDelete: async () => null };
    expect(await deleteMessage(deps, groupId, message.id)).toEqual(NOT_FOUND);
  });
});
