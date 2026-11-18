import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeAuthStore } from "@/server/adapters/fake-auth-provider";
import { createFakeDirectChatStore, resetFakeDirectChatStore } from "@/server/adapters/fake-direct-chat-store";
import { createFakeGroupStore, resetFakeGroupStore } from "@/server/adapters/fake-group-store";
import { createFakeMessageStore, resetFakeMessageStore } from "@/server/adapters/fake-message-store";
import { createMemoryRateLimiter } from "@/server/adapters/memory-rate-limiter";
import { newGroupCode, newInviteToken } from "@/server/groups/secrets";
import { chatKeyFor } from "@/server/groups/chat-key";
import type { RateLimiter } from "@/server/ports/rate-limiter";
import { CHAT_MESSAGES } from "@/shared/chat-messages";
import type { MessageView } from "@/shared/chat-types";
import { DIRECT_CHAT_MESSAGES } from "@/shared/direct-chat-messages";
import { CHAT_LIMITS } from "@/shared/messages";
import { DIRECT_OPEN_USER_LIMIT, DIRECT_SEND_USER_LIMIT } from "./direct-rate-limit-policy";
import {
  deleteDirectMessage,
  listMembersWithChatKeys,
  listPrivateChats,
  loadDirectChat,
  openDirectChat,
  privateUnread,
  sendDirectMessage,
  type DirectChatDeps,
} from "./direct-use-cases";
import { sendMessage as sendGroupMessage, loadChat as loadGroupChat } from "./use-cases";

const SITE = "https://app.test";
const SECRET = "test-service-role-key";
const MISSING_ID = "99999999-9999-4999-8999-999999999999";
const NOT_FOUND = { ok: false, notFound: true, formError: DIRECT_CHAT_MESSAGES.notFound };
const READ_ONLY = { ok: false, readOnly: true, formError: DIRECT_CHAT_MESSAGES.readOnly };
const COULD_NOT_SAVE = { ok: false, formError: CHAT_MESSAGES.couldNotSave };

type Person = { id: string; displayName: string };

/** Everything on a test clock, over the real fakes (group, direct and group-chat stores); `as(person)` gives that person's deps. */
function setup() {
  resetFakeGroupStore();
  resetFakeMessageStore();
  resetFakeDirectChatStore();
  const auth = createFakeAuthStore();
  const groups = createFakeGroupStore(auth);
  const messages = createFakeMessageStore(auth);
  const direct = createFakeDirectChatStore(auth);
  let now = Date.now();
  const limiter = createMemoryRateLimiter(() => now);
  const advance = (seconds: number) => void (now += seconds * 1000);

  const person = (displayName: string): Person => {
    const id = crypto.randomUUID();
    auth.users.set(id, { id, email: `${id}@example.test`, password: null, displayName, termsVersion: null, confirmed: true, identities: [] });
    return { id, displayName };
  };
  const as = (user: Person): DirectChatDeps => ({ groups, limiter, siteUrl: SITE, ip: "10.0.0.1", user, direct, secret: SECRET });
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
  const join = async (groupId: string, who: Person) => {
    expect(await groups.addMember(groupId, who.id)).toBe("joined");
  };
  return { auth, groups, messages, direct, limiter, advance, person, as, makeGroup, join };
}

type World = ReturnType<typeof setup>;

/** A group with an owner (Asha) and members Ravi and Mina, an outsider (Zed) and a removed member (Gone). */
async function crowd() {
  const t = setup();
  const asha = t.person("Asha");
  const ravi = t.person("Ravi");
  const mina = t.person("Mina");
  const zed = t.person("Zed");
  const gone = t.person("Gone");
  const groupId = await t.makeGroup(asha);
  await t.join(groupId, ravi);
  await t.join(groupId, mina);
  await t.join(groupId, gone);
  await t.groups.removeMember(groupId, gone.id);
  return { t, asha, ravi, mina, zed, gone, groupId };
}

const keyOf = (groupId: string, who: Person) => chatKeyFor(SECRET, groupId, who.id);
const say = (body: string, clientId: string = crypto.randomUUID()) => ({ body, clientId });
const bodies = (views: MessageView[]) => views.map((m) => m.body);

/** `from` opens the chat with `to` and expects success. */
async function open(t: World, groupId: string, from: Person, to: Person): Promise<string> {
  const result = await openDirectChat(t.as(from), groupId, keyOf(groupId, to));
  if (!result.ok) throw new Error(`openDirectChat refused: ${JSON.stringify(result)}`);
  return result.data.chatId;
}

async function sent(t: World, groupId: string, chatId: string, from: Person, body: string, clientId?: string): Promise<MessageView> {
  const result = await sendDirectMessage(t.as(from), groupId, chatId, say(body, clientId));
  if (!result.ok) throw new Error(`sendDirectMessage refused: ${JSON.stringify(result)}`);
  return result.data;
}

async function read(t: World, groupId: string, chatId: string, who: Person, query = {}) {
  const page = await loadDirectChat(t.as(who), groupId, chatId, query);
  if (!page) throw new Error("the chat was not readable");
  return page;
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** Everything `who` can try on a chat, answering as a non-participant would. */
async function expectShutOut(t: World, groupId: string, chatId: string, who: Person, cursor: string) {
  const deps = t.as(who);
  expect(await loadDirectChat(deps, groupId, chatId, {})).toBeNull();
  expect(await loadDirectChat(deps, groupId, chatId, { after: cursor })).toBeNull();
  expect(await loadDirectChat(deps, groupId, chatId, { before: cursor })).toBeNull();
  expect(await sendDirectMessage(deps, groupId, chatId, say("let me in"))).toEqual(NOT_FOUND);
  expect(await deleteDirectMessage(deps, groupId, chatId, MISSING_ID)).toEqual(NOT_FOUND);
}

describe("who may open a private chat", () => {
  it("lets one member open a chat with another by that member's chatKey, and opening again gives the same chat", async () => {
    const { t, ravi, mina, groupId } = await crowd();
    const first = await openDirectChat(t.as(mina), groupId, keyOf(groupId, ravi));
    expect(first).toEqual({ ok: true, data: { chatId: expect.stringMatching(/^[0-9a-f-]{36}$/) } });
    // From the other side, with the other's key: the same chat.
    expect(await openDirectChat(t.as(ravi), groupId, keyOf(groupId, mina))).toEqual(first);
    expect(await openDirectChat(t.as(mina), groupId, keyOf(groupId, ravi))).toEqual(first);
  });

  it("lets a member open a chat with the owner, and the owner with a member", async () => {
    const { t, asha, ravi, groupId } = await crowd();
    const withOwner = await open(t, groupId, ravi, asha);
    expect(await open(t, groupId, asha, ravi)).toBe(withOwner);
  });

  it("leaves no trace until someone writes: the chat is not in either person's list", async () => {
    const { t, ravi, mina, groupId } = await crowd();
    await open(t, groupId, mina, ravi);
    expect(await listPrivateChats(t.as(mina), groupId)).toEqual({ chats: [] });
    expect(await listPrivateChats(t.as(ravi), groupId)).toEqual({ chats: [] });
    expect(await privateUnread(t.as(ravi), groupId)).toEqual({ any: false, fromChatKeys: [] });
  });

  it("answers a garbled key, your own key, another group's key, a key of someone who left or was removed, a stranger's key and a non-string alike: not found", async () => {
    const { t, asha, ravi, mina, zed, gone, groupId } = await crowd();
    const otherGroup = await t.makeGroup(asha);
    await t.join(otherGroup, ravi);
    await t.join(otherGroup, mina);
    const quitter = t.person("Quitter");
    await t.join(groupId, quitter);
    const quitterKey = keyOf(groupId, quitter);
    await t.groups.leave(groupId, quitter.id);

    const bad: unknown[] = [
      "",
      "garbage",
      "A".repeat(43),
      keyOf(groupId, ravi).slice(1),
      `${keyOf(groupId, ravi)}x`,
      keyOf(groupId, mina), // Mina's own key, used by Mina
      keyOf(otherGroup, ravi), // another group's key for Ravi, replayed here
      keyOf(groupId, gone), // removed
      quitterKey, // left
      keyOf(groupId, zed), // never a member
      ravi.id, // an account id is not a key
      null,
      undefined,
      42,
      {},
    ];
    for (const key of bad) expect(await openDirectChat(t.as(mina), groupId, key)).toEqual(NOT_FOUND);
    // A key made with another secret is no key.
    expect(await openDirectChat(t.as(mina), groupId, chatKeyFor("not-the-secret", groupId, ravi.id))).toEqual(NOT_FOUND);
    // Nothing was made by those tries.
    expect(await t.direct.listChatsFor(groupId, mina.id)).toEqual([]);
  });

  it("a key replayed under another group's address is not found even for a member of both groups", async () => {
    const { t, asha, ravi, mina, groupId } = await crowd();
    const otherGroup = await t.makeGroup(asha);
    await t.join(otherGroup, ravi);
    await t.join(otherGroup, mina);
    expect(await openDirectChat(t.as(mina), otherGroup, keyOf(groupId, ravi))).toEqual(NOT_FOUND);
    expect(await openDirectChat(t.as(mina), groupId, keyOf(otherGroup, ravi))).toEqual(NOT_FOUND);
    // The right key under the right address works, and the chats of the two groups are different.
    expect(await open(t, groupId, mina, ravi)).not.toBe(await open(t, otherGroup, mina, ravi));
  });

  it("answers a stranger, a removed member, a member of another group, an unknown group, a malformed id and a deleted group alike", async () => {
    const { t, asha, ravi, zed, gone, groupId } = await crowd();
    const elsewhere = await t.makeGroup(zed);
    const key = keyOf(groupId, ravi);
    const attempts: [string, Person][] = [
      [groupId, zed], // not a member (the owner of another group)
      [groupId, gone], // removed
      [crypto.randomUUID(), asha],
      ["not-a-uuid", asha],
      ["", asha],
      [elsewhere, asha], // asha is not in the other group
    ];
    for (const [id, who] of attempts) expect(await openDirectChat(t.as(who), id, key)).toEqual(NOT_FOUND);
    const mina = t.person("Late");
    await t.join(groupId, mina);
    await t.groups.softDeleteGroup(groupId);
    expect(await openDirectChat(t.as(mina), groupId, key)).toEqual(NOT_FOUND);
  });

  it("a member who left cannot open a chat, and neither can a removed member who held a chat before", async () => {
    const { t, ravi, mina, groupId } = await crowd();
    await open(t, groupId, mina, ravi);
    await t.groups.removeMember(groupId, mina.id);
    expect(await openDirectChat(t.as(mina), groupId, keyOf(groupId, ravi))).toEqual(NOT_FOUND);
    await t.groups.leave(groupId, ravi.id);
    expect(await openDirectChat(t.as(ravi), groupId, keyOf(groupId, mina))).toEqual(NOT_FOUND);
  });

  it("limits openings to 30 an hour per person, apart from the group chat's limit", async () => {
    const { t, asha, ravi, groupId } = await crowd();
    const keys: string[] = [];
    const limiter: RateLimiter = {
      hit: async (input) => {
        keys.push(input.key);
        return t.limiter.hit(input);
      },
      peek: (input) => t.limiter.peek(input),
    };
    const deps = { ...t.as(asha), limiter };
    expect(DIRECT_OPEN_USER_LIMIT).toEqual({ limit: 30, windowSeconds: 3600 });
    for (let n = 0; n < 30; n++) expect((await openDirectChat(deps, groupId, keyOf(groupId, ravi))).ok).toBe(true);
    const refused = await openDirectChat(deps, groupId, keyOf(groupId, ravi));
    expect(refused).toMatchObject({ ok: false, formError: DIRECT_CHAT_MESSAGES.tooManyChats, retryAfterSeconds: expect.any(Number) });
    expect(new Set(keys)).toEqual(new Set([`dm-open:user:${asha.id}`]));
    // Someone else is not affected, and the hour passing frees the person.
    expect((await openDirectChat(t.as(ravi), groupId, keyOf(groupId, asha))).ok).toBe(true);
    t.advance(3601);
    expect((await openDirectChat(deps, groupId, keyOf(groupId, ravi))).ok).toBe(true);
  });

  it("a limiter that fails lets the request through with one fixed warning", async () => {
    const { t, ravi, mina, groupId } = await crowd();
    const deps = { ...t.as(mina), limiter: { hit: () => Promise.reject(new Error("limiter down at secret-host")), peek: () => Promise.reject(new Error("x")) } };
    expect((await openDirectChat(deps, groupId, keyOf(groupId, ravi))).ok).toBe(true);
    expect(vi.mocked(console.warn).mock.calls).toEqual([["Rate limit store unavailable; allowing the request."]]);
  });

  it("a store failure is a failure with a fixed log line that carries nothing from the error", async () => {
    const { t, ravi, mina, groupId } = await crowd();
    const deps = t.as(mina);
    deps.direct = { ...t.direct, openChat: () => Promise.reject(new Error(`db down at secret-host for ${ravi.id}`)) };
    expect(await openDirectChat(deps, groupId, keyOf(groupId, ravi))).toEqual(COULD_NOT_SAVE);
    deps.groups = { ...t.groups, listMembers: () => Promise.reject(new Error("db down at secret-host")) };
    expect(await openDirectChat(deps, groupId, keyOf(groupId, ravi))).toEqual(COULD_NOT_SAVE);
    const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logged).not.toContain("secret-host");
    expect(logged).not.toContain(ravi.id);
  });
});

describe("who may read a private chat (the participant rule)", () => {
  it("the owner, who is not one of the two, cannot list, open, read, poll, send to, delete from or learn of the chat", async () => {
    const { t, asha, ravi, mina, groupId } = await crowd();
    const chatId = await open(t, groupId, ravi, mina);
    const message = await sent(t, groupId, chatId, ravi, "just between us");
    await sent(t, groupId, chatId, mina, "yes");

    await expectShutOut(t, groupId, chatId, asha, message.cursor);
    // The owner's group power over messages does not reach in.
    expect(await deleteDirectMessage(t.as(asha), groupId, chatId, message.id)).toEqual(NOT_FOUND);
    // Nothing in the owner's list or dots: the existence of the chat is not learnt.
    expect(await listPrivateChats(t.as(asha), groupId)).toEqual({ chats: [] });
    expect(await privateUnread(t.as(asha), groupId)).toEqual({ any: false, fromChatKeys: [] });
    // And the chat is untouched, with no read position made for the owner.
    expect(bodies((await read(t, groupId, chatId, ravi)).messages)).toEqual(["just between us", "yes"]);
    expect(await t.direct.unreadSummary(groupId, asha.id)).toEqual({ any: false, fromUserIds: [] });
  });

  it("another member of the group cannot reach it either, even with the other two's keys and the chat id", async () => {
    const { t, ravi, mina, groupId } = await crowd();
    const chatId = await open(t, groupId, ravi, mina);
    const message = await sent(t, groupId, chatId, ravi, "just between us");
    const zoe = t.person("Zoe");
    await t.join(groupId, zoe);

    await expectShutOut(t, groupId, chatId, zoe, message.cursor);
    expect(await deleteDirectMessage(t.as(zoe), groupId, chatId, message.id)).toEqual(NOT_FOUND);
    expect(await listPrivateChats(t.as(zoe), groupId)).toEqual({ chats: [] });
    // Opening a chat with Ravi by his key makes Zoe's OWN chat with him, which holds nothing of Mina's.
    const own = await open(t, groupId, zoe, ravi);
    expect(own).not.toBe(chatId);
    expect((await read(t, groupId, own, zoe)).messages).toEqual([]);
  });

  it("a stranger, a removed member, a member of another group and the owner of another group get nothing", async () => {
    const { t, ravi, mina, zed, gone, groupId } = await crowd();
    const chatId = await open(t, groupId, ravi, mina);
    const message = await sent(t, groupId, chatId, ravi, "secret");
    for (const who of [zed, gone]) {
      await expectShutOut(t, groupId, chatId, who, message.cursor);
      expect(await listPrivateChats(t.as(who), groupId)).toBeNull();
      expect(await privateUnread(t.as(who), groupId)).toEqual({ any: false, fromChatKeys: [] });
    }
    const otherGroup = await t.makeGroup(zed);
    // Zed owns another group and uses ITS address with this chat's id.
    await expectShutOut(t, otherGroup, chatId, zed, message.cursor);
  });

  it("answers an unknown group, a malformed group id, an unknown or malformed chat id and a deleted group exactly alike", async () => {
    const { t, ravi, mina, groupId } = await crowd();
    const chatId = await open(t, groupId, ravi, mina);
    const message = await sent(t, groupId, chatId, ravi, "hi");
    const attempts: [string, string][] = [
      [crypto.randomUUID(), chatId],
      ["not-a-uuid", chatId],
      ["", chatId],
      [groupId, MISSING_ID],
      [groupId, "not-a-uuid"],
      [groupId, ""],
      [groupId, `${chatId}0`],
    ];
    for (const [g, c] of attempts) await expectShutOut(t, g, c, ravi, message.cursor);

    await t.groups.softDeleteGroup(groupId);
    await expectShutOut(t, groupId, chatId, ravi, message.cursor);
    expect(await deleteDirectMessage(t.as(ravi), groupId, chatId, message.id)).toEqual(NOT_FOUND);
    expect(await listPrivateChats(t.as(ravi), groupId)).toBeNull();
  });

  it("a chat id of group A under group B's address is not found, for a participant who is a member of B only", async () => {
    const { t, asha, ravi, mina, groupId } = await crowd();
    const chatA = await open(t, groupId, ravi, mina);
    const message = await sent(t, groupId, chatA, ravi, "in A");

    const groupB = await t.makeGroup(asha);
    await t.join(groupB, ravi);
    // Ravi leaves A, so he is a participant of chat A and a member of B only.
    await t.groups.leave(groupId, ravi.id);
    await expectShutOut(t, groupB, chatA, ravi, message.cursor);
    expect(await deleteDirectMessage(t.as(ravi), groupB, chatA, message.id)).toEqual(NOT_FOUND);
    // Under A's own address he is shut out as a non-member.
    await expectShutOut(t, groupId, chatA, ravi, message.cursor);
  });

  it("a chat id of group A under group B's address is not found for a participant who is a member of BOTH", async () => {
    const { t, asha, ravi, mina, groupId } = await crowd();
    const chatA = await open(t, groupId, ravi, mina);
    const message = await sent(t, groupId, chatA, ravi, "in A");
    const groupB = await t.makeGroup(asha);
    await t.join(groupB, ravi);
    await t.join(groupB, mina);
    const chatB = await open(t, groupB, ravi, mina);
    await sent(t, groupB, chatB, ravi, "in B");

    await expectShutOut(t, groupB, chatA, ravi, message.cursor);
    await expectShutOut(t, groupB, chatA, mina, message.cursor);
    await expectShutOut(t, groupId, chatB, ravi, message.cursor);
    expect(await deleteDirectMessage(t.as(ravi), groupB, chatA, message.id)).toEqual(NOT_FOUND);
    // The message id of A under B's chat is not found either (and nothing was deleted).
    expect(await deleteDirectMessage(t.as(ravi), groupB, chatB, message.id)).toEqual(NOT_FOUND);
    expect(bodies((await read(t, groupId, chatA, ravi)).messages)).toEqual(["in A"]);
    // A's cursor under B's chat is only a position: nothing of A shows up.
    expect(JSON.stringify(await read(t, groupB, chatB, ravi, { after: message.cursor }))).not.toContain("in A");
    expect(JSON.stringify(await read(t, groupB, chatB, ravi, { before: message.cursor }))).not.toContain("in A");
  });

  it("the other person leaves or is removed: the stayer still reads but cannot send or delete, the leaver cannot read, and rejoining restores the same chat", async () => {
    const { t, ravi, mina, groupId } = await crowd();
    const chatId = await open(t, groupId, ravi, mina);
    const mine = await sent(t, groupId, chatId, mina, "from the stayer");
    const theirs = await sent(t, groupId, chatId, ravi, "from the leaver");

    // Ravi leaves.
    await t.groups.leave(groupId, ravi.id);
    const stayer = await read(t, groupId, chatId, mina);
    expect(stayer).toMatchObject({ canSend: false, otherGone: true, otherName: "Ravi" });
    expect(bodies(stayer.messages)).toEqual(["from the stayer", "from the leaver"]);
    expect(stayer.messages.every((m) => !m.canDelete)).toBe(true);
    expect(await sendDirectMessage(t.as(mina), groupId, chatId, say("hello?"))).toEqual(READ_ONLY);
    expect(await deleteDirectMessage(t.as(mina), groupId, chatId, mine.id)).toEqual(READ_ONLY);
    // The conversation is still in the stayer's list, marked as gone.
    expect(await listPrivateChats(t.as(mina), groupId)).toEqual({
      chats: [{ chatId, name: "Ravi", otherGone: true, preview: "from the leaver", lastAt: expect.any(String), unread: false }],
    });
    // The leaver sees nothing, and cannot write or delete.
    await expectShutOut(t, groupId, chatId, ravi, theirs.cursor);
    expect(await deleteDirectMessage(t.as(ravi), groupId, chatId, theirs.id)).toEqual(NOT_FOUND);
    expect(await listPrivateChats(t.as(ravi), groupId)).toBeNull();
    // Nothing was added or deleted meanwhile.
    expect(bodies((await read(t, groupId, chatId, mina)).messages)).toEqual(["from the stayer", "from the leaver"]);

    // Rejoining restores the same chat, with its history, for both.
    await t.join(groupId, ravi);
    const back = await read(t, groupId, chatId, ravi);
    expect(back).toMatchObject({ canSend: true, otherGone: false, otherName: "Mina" });
    expect(bodies(back.messages)).toEqual(["from the stayer", "from the leaver"]);
    expect(await open(t, groupId, ravi, mina)).toBe(chatId);
    expect((await sendDirectMessage(t.as(mina), groupId, chatId, say("welcome back"))).ok).toBe(true);
    expect((await deleteDirectMessage(t.as(ravi), groupId, chatId, theirs.id)).ok).toBe(true);
  });

  it("a removed member loses the chat, the stayer reads it read-only, and a removed member cannot rejoin", async () => {
    const { t, ravi, mina, groupId } = await crowd();
    const chatId = await open(t, groupId, ravi, mina);
    const message = await sent(t, groupId, chatId, ravi, "hello");
    await t.groups.removeMember(groupId, ravi.id);

    await expectShutOut(t, groupId, chatId, ravi, message.cursor);
    expect(await deleteDirectMessage(t.as(ravi), groupId, chatId, message.id)).toEqual(NOT_FOUND);
    expect(await listPrivateChats(t.as(ravi), groupId)).toBeNull();
    expect(await read(t, groupId, chatId, mina)).toMatchObject({ canSend: false, otherGone: true });
    expect(await sendDirectMessage(t.as(mina), groupId, chatId, say("hello?"))).toEqual(READ_ONLY);
    // The group's removal rule still holds: the join is refused, so access cannot come back that way.
    expect(await t.groups.addMember(groupId, ravi.id)).toBe("removed");
    await expectShutOut(t, groupId, chatId, ravi, message.cursor);
  });

  it("the stayer of a chat whose other person never wrote still gets a name, and a gone person's name is shown", async () => {
    const { t, ravi, mina, groupId } = await crowd();
    const chatId = await open(t, groupId, ravi, mina);
    await t.groups.leave(groupId, ravi.id);
    expect(await read(t, groupId, chatId, mina)).toMatchObject({ otherGone: true, otherName: DIRECT_CHAT_MESSAGES.formerMember });
    await t.join(groupId, ravi);
    await sent(t, groupId, chatId, ravi, "back");
    await t.groups.leave(groupId, ravi.id);
    expect(await read(t, groupId, chatId, mina)).toMatchObject({ otherGone: true, otherName: "Ravi" });
  });

  it("a participant who is the owner has no extra power: the other person's messages cannot be deleted by them", async () => {
    const { t, asha, ravi, groupId } = await crowd();
    const chatId = await open(t, groupId, asha, ravi);
    const theirs = await sent(t, groupId, chatId, ravi, "mine, Ravi's");
    const ours = await sent(t, groupId, chatId, asha, "the owner's");

    const page = await read(t, groupId, chatId, asha);
    expect(page.messages.map((m) => [m.body, m.mine, m.canDelete])).toEqual([
      ["mine, Ravi's", false, false],
      ["the owner's", true, true],
    ]);
    expect(await deleteDirectMessage(t.as(asha), groupId, chatId, theirs.id)).toEqual(NOT_FOUND);
    expect(bodies((await read(t, groupId, chatId, ravi)).messages)).toEqual(["mine, Ravi's", "the owner's"]);
    // Her own is hers to delete.
    expect(await deleteDirectMessage(t.as(asha), groupId, chatId, ours.id)).toEqual({ ok: true, data: undefined });
    // The page has no sign of a delete-any power.
    expect(Object.keys(page).sort()).toEqual(["canSend", "cursor", "hasMore", "messages", "otherGone", "otherName"]);
  });

  it("ownership moving to a participant or away changes nothing about who can read", async () => {
    const { t, asha, ravi, mina, groupId } = await crowd();
    const chatId = await open(t, groupId, ravi, mina);
    const message = await sent(t, groupId, chatId, ravi, "hi");
    expect(await t.groups.transferOwnership(groupId, asha.id, ravi.id)).toBe("ok");
    // Asha is a plain member now, Ravi the owner: both rules are the same.
    await expectShutOut(t, groupId, chatId, asha, message.cursor);
    expect((await read(t, groupId, chatId, mina)).messages).toHaveLength(1);
    const ownerRavi = await read(t, groupId, chatId, ravi);
    expect(ownerRavi.messages.map((m) => m.canDelete)).toEqual([true]);
  });
});

describe("loadDirectChat", () => {
  it("returns the latest page oldest first, then newer messages after a cursor and earlier ones before it", async () => {
    const { t, ravi, mina, groupId } = await crowd();
    const chatId = await open(t, groupId, ravi, mina);
    const views: MessageView[] = [];
    for (let n = 1; n <= 5; n++) views.push(await sent(t, groupId, chatId, n % 2 ? ravi : mina, `m${n}`));

    const latest = await read(t, groupId, chatId, mina);
    expect(bodies(latest.messages)).toEqual(["m1", "m2", "m3", "m4", "m5"]);
    expect(latest).toMatchObject({ hasMore: false, cursor: views[4].cursor, canSend: true, otherName: "Ravi", otherGone: false });
    const news = await read(t, groupId, chatId, mina, { after: views[2].cursor });
    expect(bodies(news.messages)).toEqual(["m4", "m5"]);
    const older = await read(t, groupId, chatId, mina, { before: views[3].cursor });
    expect(bodies(older.messages)).toEqual(["m1", "m2", "m3"]);
    expect(older.cursor).toBeNull();
    // Up to date: nothing new, and the cursor given stays the place to poll from.
    expect(await read(t, groupId, chatId, mina, { after: views[4].cursor })).toMatchObject({ messages: [], cursor: views[4].cursor });
    // A cursor that is not one gives the latest page, and `after` wins over `before`.
    expect(bodies((await read(t, groupId, chatId, mina, { after: "garbage" })).messages)).toEqual(["m1", "m2", "m3", "m4", "m5"]);
    expect(bodies((await read(t, groupId, chatId, mina, { after: views[3].cursor, before: views[1].cursor })).messages)).toEqual(["m5"]);
  });

  it("pages of 50, saying whether more are waiting", async () => {
    const { t, ravi, mina, groupId } = await crowd();
    const chatId = await open(t, groupId, ravi, mina);
    // Straight into the store: sending 53 messages through the use-case would hit the 20 a minute limit.
    for (let n = 1; n <= CHAT_LIMITS.pageSize + 3; n++) {
      await t.direct.send({ chatId, senderId: ravi.id, clientId: crypto.randomUUID(), body: `n${n}` });
    }
    const latest = await read(t, groupId, chatId, mina);
    expect(latest.messages).toHaveLength(CHAT_LIMITS.pageSize);
    expect(latest.hasMore).toBe(true);
    const earlier = await read(t, groupId, chatId, mina, { before: latest.messages[0].cursor });
    expect(bodies(earlier.messages)).toEqual(["n1", "n2", "n3"]);
    expect(earlier.hasMore).toBe(false);
  });

  it("marks MINE and which messages I may delete from the private rules, and never shows an account id", async () => {
    const { t, ravi, mina, groupId } = await crowd();
    const chatId = await open(t, groupId, ravi, mina);
    await sent(t, groupId, chatId, ravi, "from Ravi");
    await sent(t, groupId, chatId, mina, "from Mina");
    const page = await read(t, groupId, chatId, mina);
    expect(page.messages.map((m) => [m.body, m.senderName, m.mine, m.canDelete])).toEqual([
      ["from Ravi", "Ravi", false, false],
      ["from Mina", "Mina", true, true],
    ]);
    const json = JSON.stringify([page, await listPrivateChats(t.as(mina), groupId)]);
    for (const id of [ravi.id, mina.id]) expect(json).not.toContain(id);
    expect(Object.keys(page.messages[0]).sort()).toEqual(["body", "canDelete", "clientId", "createdAt", "cursor", "id", "mine", "senderName"]);
  });

  it("moves the reader's position when the newest messages are shown: the latest page and a poll with news, but not an earlier page", async () => {
    const { t, asha, ravi, mina, groupId } = await crowd();
    const chatId = await open(t, groupId, ravi, mina);
    const [m1, m2, m3] = [await sent(t, groupId, chatId, ravi, "m1"), await sent(t, groupId, chatId, ravi, "m2"), await sent(t, groupId, chatId, ravi, "m3")];
    const unread = async (who: Person) => (await privateUnread(t.as(who), groupId)).any;
    expect(await unread(mina)).toBe(true);

    // An earlier page does not mark anything as seen.
    await read(t, groupId, chatId, mina, { before: m3.cursor });
    expect(await unread(mina)).toBe(true);
    // The sender reading their own chat changes nothing for the other person.
    await read(t, groupId, chatId, ravi);
    expect(await unread(mina)).toBe(true);
    // Somebody shut out cannot mark it read for the reader.
    await loadDirectChat(t.as(asha), groupId, chatId, {});
    expect(await unread(mina)).toBe(true);
    // A cursor that is not one gives the latest page, which marks the newest message as seen.
    await read(t, groupId, chatId, mina, { after: "garbage-that-is-not-a-cursor" });
    expect(await unread(mina)).toBe(false);

    // A new message flags it again; an empty poll does not clear it; a poll with the news does.
    const m4 = await sent(t, groupId, chatId, ravi, "m4");
    expect(await unread(mina)).toBe(true);
    await read(t, groupId, chatId, mina, { after: m4.cursor });
    expect(await unread(mina)).toBe(true);
    await read(t, groupId, chatId, mina, { after: m3.cursor });
    expect(await unread(mina)).toBe(false);
    // Reading an older page after that never brings the dot back.
    await read(t, groupId, chatId, mina, { before: m2.cursor });
    await read(t, groupId, chatId, mina, { after: m1.cursor });
    expect(await unread(mina)).toBe(false);
  });

  it("a read that cannot mark the chat as read still answers, with a fixed log line", async () => {
    const { t, ravi, mina, groupId } = await crowd();
    const chatId = await open(t, groupId, ravi, mina);
    await sent(t, groupId, chatId, ravi, "hi");
    const deps = t.as(mina);
    deps.direct = { ...t.direct, markRead: () => Promise.reject(new Error(`db down at secret-host ${mina.id}`)) };
    expect(bodies((await loadDirectChat(deps, groupId, chatId, {}))!.messages)).toEqual(["hi"]);
    expect(vi.mocked(console.error).mock.calls).toEqual([["Could not mark a private chat as read."]]);
  });

  it("a store failure is thrown, never turned into 'not found'", async () => {
    const { t, ravi, mina, groupId } = await crowd();
    const chatId = await open(t, groupId, ravi, mina);
    for (const broken of [
      { direct: { ...t.direct, findChat: () => Promise.reject(new Error("down")) } },
      { direct: { ...t.direct, listLatest: () => Promise.reject(new Error("down")) } },
      { groups: { ...t.groups, findById: () => Promise.reject(new Error("down")) } },
      { groups: { ...t.groups, listMembers: () => Promise.reject(new Error("down")) } },
    ]) {
      await expect(loadDirectChat({ ...t.as(mina), ...broken }, groupId, chatId, {})).rejects.toThrow();
    }
  });
});

describe("sendDirectMessage", () => {
  it("saves a message and returns a client-safe view, which both people then see", async () => {
    const { t, ravi, mina, groupId } = await crowd();
    const chatId = await open(t, groupId, ravi, mina);
    const clientId = crypto.randomUUID();
    const result = await sendDirectMessage(t.as(mina), groupId, chatId, { body: "hello", clientId });
    expect(result).toEqual({
      ok: true,
      data: {
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        clientId,
        body: "hello",
        senderName: "Mina",
        mine: true,
        canDelete: true,
        createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
        cursor: expect.any(String),
      },
    });
    expect(JSON.stringify(result)).not.toContain(mina.id);
    expect(bodies((await read(t, groupId, chatId, ravi)).messages)).toEqual(["hello"]);
    expect((await read(t, groupId, chatId, ravi)).messages[0]).toMatchObject({ mine: false, canDelete: false, senderName: "Mina" });
  });

  it("uses the group chat's cleaning and limits", async () => {
    const { t, ravi, mina, groupId } = await crowd();
    const chatId = await open(t, groupId, ravi, mina);
    expect((await sent(t, groupId, chatId, mina, "   hello  \n  ")).body).toBe("hello");
    expect((await sent(t, groupId, chatId, mina, "a\r\nb\rc\nd")).body).toBe("a\nb\nc\nd");
    expect((await sent(t, groupId, chatId, mina, "one\n\n\ntwo   three")).body).toBe("one\n\n\ntwo   three");
    expect((await sent(t, groupId, chatId, mina, "no\u0000ul\u0007bell")).body).toBe("noulbell");
    for (const body of ["", "   ", "\n\n", "\u0000"]) {
      expect(await sendDirectMessage(t.as(mina), groupId, chatId, say(body))).toEqual({ ok: false, fieldErrors: { body: CHAT_MESSAGES.bodyRequired } });
    }
    expect((await sendDirectMessage(t.as(mina), groupId, chatId, say("x".repeat(CHAT_LIMITS.maxBody)))).ok).toBe(true);
    expect((await sendDirectMessage(t.as(mina), groupId, chatId, say("\u{1F600}".repeat(CHAT_LIMITS.maxBody)))).ok).toBe(true);
    const tooLong = { ok: false, fieldErrors: { body: CHAT_MESSAGES.bodyTooLong } };
    expect(await sendDirectMessage(t.as(mina), groupId, chatId, say("x".repeat(CHAT_LIMITS.maxBody + 1)))).toEqual(tooLong);
    expect(await sendDirectMessage(t.as(mina), groupId, chatId, say("x".repeat(1_000_000)))).toEqual(tooLong);
  });

  it("refuses a bad client id, a missing field and a form that is not an object, saving nothing", async () => {
    const { t, ravi, mina, groupId } = await crowd();
    const chatId = await open(t, groupId, ravi, mina);
    const deps = t.as(mina);
    for (const clientId of ["", "abc", crypto.randomUUID() + "x", 5, null, undefined]) {
      expect(await sendDirectMessage(deps, groupId, chatId, { body: "hi", clientId })).toEqual({
        ok: false,
        fieldErrors: { clientId: CHAT_MESSAGES.badForm },
      });
    }
    expect(await sendDirectMessage(deps, groupId, chatId, { clientId: crypto.randomUUID() })).toMatchObject({ ok: false, fieldErrors: { body: expect.any(String) } });
    expect(await sendDirectMessage(deps, groupId, chatId, null)).toEqual({ ok: false, formError: CHAT_MESSAGES.badForm });
    expect(await sendDirectMessage(deps, groupId, chatId, "hello")).toEqual({ ok: false, formError: CHAT_MESSAGES.badForm });
    expect((await read(t, groupId, chatId, mina)).messages).toEqual([]);
  });

  it("ignores extra fields, so a sender, a chat or a time cannot be forged", async () => {
    const { t, asha, ravi, mina, groupId } = await crowd();
    const chatId = await open(t, groupId, ravi, mina);
    const elsewhere = await open(t, groupId, ravi, asha);
    const result = await sendDirectMessage(t.as(mina), groupId, chatId, {
      ...say("hi"),
      senderId: ravi.id,
      chatId: elsewhere,
      groupId: crypto.randomUUID(),
      createdAt: "2001-01-01T00:00:00Z",
    });
    expect(result).toMatchObject({ ok: true, data: { senderName: "Mina", mine: true } });
    expect(result.ok && result.data.createdAt.startsWith("2001")).toBe(false);
    expect(bodies((await read(t, groupId, chatId, ravi)).messages)).toEqual(["hi"]);
    expect((await read(t, groupId, elsewhere, ravi)).messages).toEqual([]);
  });

  it("is safe to repeat: the same client id answers with the first message and saves nothing new", async () => {
    const { t, ravi, mina, groupId } = await crowd();
    const chatId = await open(t, groupId, ravi, mina);
    const clientId = crypto.randomUUID();
    const first = await sent(t, groupId, chatId, mina, "once", clientId);
    expect(await sent(t, groupId, chatId, mina, "once", clientId)).toEqual(first);
    // Even in other letter case, or with another body: the first message stands.
    expect(await sent(t, groupId, chatId, mina, "twice", clientId.toUpperCase())).toEqual(first);
    expect(bodies((await read(t, groupId, chatId, ravi)).messages)).toEqual(["once"]);
  });

  it("refuses a client id that belongs to the other person's message, and one whose message was deleted", async () => {
    const { t, ravi, mina, groupId } = await crowd();
    const chatId = await open(t, groupId, ravi, mina);
    const clientId = crypto.randomUUID();
    await sent(t, groupId, chatId, ravi, "theirs", clientId);
    expect(await sendDirectMessage(t.as(mina), groupId, chatId, say("mine now", clientId))).toEqual(COULD_NOT_SAVE);

    const oops = await sent(t, groupId, chatId, mina, "oops", crypto.randomUUID());
    await deleteDirectMessage(t.as(mina), groupId, chatId, oops.id);
    expect(await sendDirectMessage(t.as(mina), groupId, chatId, { body: "oops", clientId: oops.clientId })).toEqual({
      ok: false,
      formError: CHAT_MESSAGES.messageRemoved,
    });
    expect(bodies((await read(t, groupId, chatId, ravi)).messages)).toEqual(["theirs"]);
  });

  it("limits sending to 20 a minute per person, counted apart from the group chat and from the other person", async () => {
    const { t, ravi, mina, groupId } = await crowd();
    const chatId = await open(t, groupId, ravi, mina);
    const keys: string[] = [];
    const limiter: RateLimiter = {
      hit: async (input) => {
        keys.push(input.key);
        return t.limiter.hit(input);
      },
      peek: (input) => t.limiter.peek(input),
    };
    const deps = { ...t.as(mina), limiter };
    expect(DIRECT_SEND_USER_LIMIT).toEqual({ limit: 20, windowSeconds: 60 });
    for (let n = 0; n < 20; n++) expect((await sendDirectMessage(deps, groupId, chatId, say(`n${n}`))).ok).toBe(true);
    const refused = await sendDirectMessage(deps, groupId, chatId, say("one too many"));
    expect(refused).toMatchObject({ ok: false, formError: CHAT_MESSAGES.tooMany, retryAfterSeconds: expect.any(Number) });
    expect(new Set(keys)).toEqual(new Set([`dm-send:user:${mina.id}`]));
    expect((await read(t, groupId, chatId, ravi)).messages).toHaveLength(20);
    // Ravi is not affected; Mina's group chat is not either (it has its own key); a minute frees her.
    expect((await sendDirectMessage(t.as(ravi), groupId, chatId, say("reply"))).ok).toBe(true);
    expect((await sendGroupMessage({ ...t.as(mina), messages: t.messages }, groupId, say("group chat"))).ok).toBe(true);
    t.advance(61);
    expect((await sendDirectMessage(deps, groupId, chatId, say("again"))).ok).toBe(true);
  });

  it("is refused before the limiter is counted when the person may not write", async () => {
    const { t, ravi, mina, zed, groupId } = await crowd();
    const chatId = await open(t, groupId, ravi, mina);
    const hit = vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 }));
    const limiter: RateLimiter = { hit, peek: hit };
    expect(await sendDirectMessage({ ...t.as(zed), limiter }, groupId, chatId, say("hi"))).toEqual(NOT_FOUND);
    await t.groups.leave(groupId, ravi.id);
    expect(await sendDirectMessage({ ...t.as(mina), limiter }, groupId, chatId, say("hi"))).toEqual(READ_ONLY);
    expect(hit).not.toHaveBeenCalled();
  });

  it("a store failure is a failure with a fixed log line that carries nothing from the error", async () => {
    const { t, ravi, mina, groupId } = await crowd();
    const chatId = await open(t, groupId, ravi, mina);
    const failing = (message: string) => Promise.reject(new Error(`${message} secret-host ${mina.id}`));
    for (const broken of [
      { direct: { ...t.direct, send: () => failing("send") } },
      { direct: { ...t.direct, findChat: () => failing("find") } },
      { groups: { ...t.groups, findById: () => failing("group") } },
      { groups: { ...t.groups, listMembers: () => failing("members") } },
    ]) {
      expect(await sendDirectMessage({ ...t.as(mina), ...broken }, groupId, chatId, say("hi"))).toEqual(COULD_NOT_SAVE);
    }
    const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logged).not.toContain("secret-host");
    expect(logged).not.toContain(mina.id);
    expect(bodies((await read(t, groupId, chatId, ravi)).messages)).toEqual([]);
  });
});

describe("deleteDirectMessage", () => {
  it("lets the sender delete their own message, which both people then no longer see", async () => {
    const { t, ravi, mina, groupId } = await crowd();
    const chatId = await open(t, groupId, ravi, mina);
    const keep = await sent(t, groupId, chatId, mina, "keep");
    const gone = await sent(t, groupId, chatId, mina, "oops");
    expect(await deleteDirectMessage(t.as(mina), groupId, chatId, gone.id)).toEqual({ ok: true, data: undefined });
    expect(bodies((await read(t, groupId, chatId, ravi)).messages)).toEqual(["keep"]);
    // Gone already: not found, like any message that is not there.
    expect(await deleteDirectMessage(t.as(mina), groupId, chatId, gone.id)).toEqual(NOT_FOUND);
    expect(keep.id).not.toBe(gone.id);
  });

  it("refuses the other person's message with the answer a made-up id gets, and leaves it in place", async () => {
    const { t, ravi, mina, groupId } = await crowd();
    const chatId = await open(t, groupId, ravi, mina);
    const theirs = await sent(t, groupId, chatId, ravi, "theirs");
    expect(await deleteDirectMessage(t.as(mina), groupId, chatId, theirs.id)).toEqual(NOT_FOUND);
    expect(await deleteDirectMessage(t.as(mina), groupId, chatId, MISSING_ID)).toEqual(NOT_FOUND);
    for (const id of ["", "not-a-uuid", `${theirs.id}0`]) expect(await deleteDirectMessage(t.as(mina), groupId, chatId, id)).toEqual(NOT_FOUND);
    expect(bodies((await read(t, groupId, chatId, ravi)).messages)).toEqual(["theirs"]);
  });

  it("never reaches a message of another chat, even one the person is in, or a group chat message", async () => {
    const { t, asha, ravi, mina, groupId } = await crowd();
    const chatA = await open(t, groupId, ravi, mina);
    const chatB = await open(t, groupId, ravi, asha);
    const inA = await sent(t, groupId, chatA, ravi, "in A");
    const inB = await sent(t, groupId, chatB, ravi, "in B");
    // Ravi is in both chats and wrote both messages: the chat in the address decides.
    expect(await deleteDirectMessage(t.as(ravi), groupId, chatA, inB.id)).toEqual(NOT_FOUND);
    expect(await deleteDirectMessage(t.as(ravi), groupId, chatB, inA.id)).toEqual(NOT_FOUND);
    // A group chat message id finds nothing in a private chat.
    const group = await sendGroupMessage({ ...t.as(ravi), messages: t.messages }, groupId, say("to everyone"));
    if (!group.ok) throw new Error("group send failed");
    expect(await deleteDirectMessage(t.as(ravi), groupId, chatA, group.data.id)).toEqual(NOT_FOUND);
    expect((await loadGroupChat({ ...t.as(ravi), messages: t.messages }, groupId))?.messages.map((m) => m.body)).toEqual(["to everyone"]);
    expect(bodies((await read(t, groupId, chatA, mina)).messages)).toEqual(["in A"]);
    expect(bodies((await read(t, groupId, chatB, asha)).messages)).toEqual(["in B"]);
  });

  it("a store failure is a failure, with a fixed log line", async () => {
    const { t, ravi, mina, groupId } = await crowd();
    const chatId = await open(t, groupId, ravi, mina);
    const message = await sent(t, groupId, chatId, mina, "hi");
    const deps = t.as(mina);
    deps.direct = { ...t.direct, softDelete: () => Promise.reject(new Error(`down secret-host ${mina.id}`)) };
    expect(await deleteDirectMessage(deps, groupId, chatId, message.id)).toEqual(COULD_NOT_SAVE);
    deps.direct = { ...t.direct, findChat: () => Promise.reject(new Error(`down secret-host ${mina.id}`)) };
    expect(await deleteDirectMessage(deps, groupId, chatId, message.id)).toEqual(COULD_NOT_SAVE);
    const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logged).not.toContain("secret-host");
    expect(logged).not.toContain(mina.id);
  });
});

describe("listPrivateChats", () => {
  it("lists only chats with a message, newest first, for both people, with a one-line preview", async () => {
    const { t, asha, ravi, mina, groupId } = await crowd();
    const withRavi = await open(t, groupId, mina, ravi);
    const withAsha = await open(t, groupId, mina, asha);
    await open(t, groupId, ravi, asha); // never written in
    await sent(t, groupId, withRavi, ravi, "first\n\n   line  two");
    await sent(t, groupId, withAsha, asha, "x".repeat(200));

    const list = await listPrivateChats(t.as(mina), groupId);
    expect(list?.chats.map((c) => [c.chatId, c.name, c.otherGone])).toEqual([
      [withAsha, "Asha", false],
      [withRavi, "Ravi", false],
    ]);
    expect(list?.chats[0].preview).toBe("x".repeat(80));
    expect(list?.chats[1].preview).toBe("first line two");
    expect(list?.chats[0].lastAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    expect((await listPrivateChats(t.as(ravi), groupId))?.chats.map((c) => c.name)).toEqual(["Mina"]);
    expect((await listPrivateChats(t.as(asha), groupId))?.chats.map((c) => c.name)).toEqual(["Mina"]);
    // Nobody else sees any of it, and nothing in it is an account id.
    expect(JSON.stringify(list)).not.toMatch(new RegExp([asha.id, ravi.id, mina.id].join("|")));
  });

  it("shows the unread dot for the other person's news and clears it once read", async () => {
    const { t, ravi, mina, groupId } = await crowd();
    const chatId = await open(t, groupId, ravi, mina);
    await sent(t, groupId, chatId, ravi, "hi Mina");
    expect((await listPrivateChats(t.as(mina), groupId))?.chats[0].unread).toBe(true);
    expect((await listPrivateChats(t.as(ravi), groupId))?.chats[0].unread).toBe(false);
    await read(t, groupId, chatId, mina);
    expect((await listPrivateChats(t.as(mina), groupId))?.chats[0].unread).toBe(false);
  });

  it("is null for anyone who may not use the group, and a store failure throws", async () => {
    const { t, zed, gone, mina, groupId } = await crowd();
    for (const who of [zed, gone]) expect(await listPrivateChats(t.as(who), groupId)).toBeNull();
    expect(await listPrivateChats(t.as(mina), "not-a-uuid")).toBeNull();
    expect(await listPrivateChats(t.as(mina), crypto.randomUUID())).toBeNull();
    await expect(
      listPrivateChats({ ...t.as(mina), direct: { ...t.direct, listChatsFor: () => Promise.reject(new Error("down")) } }, groupId),
    ).rejects.toThrow();
  });
});

describe("privateUnread", () => {
  it("says who wrote, by chatKey, and only for chats with something unread", async () => {
    const { t, asha, ravi, mina, groupId } = await crowd();
    const fromRavi = await open(t, groupId, mina, ravi);
    const fromAsha = await open(t, groupId, mina, asha);
    await sent(t, groupId, fromRavi, ravi, "hi");
    await sent(t, groupId, fromAsha, asha, "hello");

    const summary = await privateUnread(t.as(mina), groupId);
    expect(summary.any).toBe(true);
    expect([...summary.fromChatKeys].sort()).toEqual([keyOf(groupId, ravi), keyOf(groupId, asha)].sort());
    expect(JSON.stringify(summary)).not.toMatch(new RegExp([asha.id, ravi.id].join("|")));
    // These are the very codes the Members list hands out.
    expect(await openDirectChat(t.as(mina), groupId, summary.fromChatKeys[0])).toMatchObject({ ok: true });

    await read(t, groupId, fromRavi, mina);
    expect(await privateUnread(t.as(mina), groupId)).toEqual({ any: true, fromChatKeys: [keyOf(groupId, asha)] });
    await read(t, groupId, fromAsha, mina);
    expect(await privateUnread(t.as(mina), groupId)).toEqual({ any: false, fromChatKeys: [] });
    // The senders have nothing unread.
    expect(await privateUnread(t.as(ravi), groupId)).toEqual({ any: false, fromChatKeys: [] });
  });

  it("keeps the dot for someone who has left, but gives no key for a member who is not in the list", async () => {
    const { t, ravi, mina, groupId } = await crowd();
    const chatId = await open(t, groupId, mina, ravi);
    await sent(t, groupId, chatId, ravi, "bye");
    await t.groups.leave(groupId, ravi.id);
    expect(await privateUnread(t.as(mina), groupId)).toEqual({ any: true, fromChatKeys: [] });
  });

  it("is empty for anyone who may not use the group, and never fails the page: a store failure is empty with a fixed log line", async () => {
    const { t, ravi, mina, zed, gone, groupId } = await crowd();
    const chatId = await open(t, groupId, mina, ravi);
    await sent(t, groupId, chatId, ravi, "hi");
    for (const who of [zed, gone]) expect(await privateUnread(t.as(who), groupId)).toEqual({ any: false, fromChatKeys: [] });
    expect(await privateUnread(t.as(mina), "not-a-uuid")).toEqual({ any: false, fromChatKeys: [] });
    expect(await privateUnread(t.as(mina), crypto.randomUUID())).toEqual({ any: false, fromChatKeys: [] });
    const deps = t.as(mina);
    deps.direct = { ...t.direct, unreadSummary: () => Promise.reject(new Error(`down secret-host ${mina.id}`)) };
    expect(await privateUnread(deps, groupId)).toEqual({ any: false, fromChatKeys: [] });
    deps.groups = { ...t.groups, findById: () => Promise.reject(new Error("down secret-host")) };
    expect(await privateUnread(deps, groupId)).toEqual({ any: false, fromChatKeys: [] });
    expect(vi.mocked(console.error).mock.calls).toEqual([
      ["Could not check for unread private messages."],
      ["Could not check for unread private messages."],
    ]);
  });
});

describe("listMembersWithChatKeys", () => {
  it("gives each OTHER member a chatKey, never your own row, and no account id to a plain member", async () => {
    const { t, asha, ravi, mina, groupId } = await crowd();
    const rows = await listMembersWithChatKeys(t.as(mina), groupId);
    expect(rows?.map((r) => [r.displayName, r.isYou, r.chatKey])).toEqual([
      ["Asha", false, keyOf(groupId, asha)],
      ["Ravi", false, keyOf(groupId, ravi)],
      ["Mina", true, null],
    ]);
    expect(JSON.stringify(rows)).not.toMatch(new RegExp([asha.id, ravi.id, mina.id].join("|")));
    // Every key works for opening a chat with that member.
    for (const row of rows ?? []) if (row.chatKey) expect(await openDirectChat(t.as(mina), groupId, row.chatKey)).toMatchObject({ ok: true });
  });

  it("keeps the group's existing rule for ids (only the owner sees them) and its removed members out", async () => {
    const { t, asha, ravi, gone, groupId } = await crowd();
    const asOwner = await listMembersWithChatKeys(t.as(asha), groupId);
    expect(asOwner?.map((r) => r.userId).filter(Boolean)).toHaveLength(3);
    expect(asOwner?.some((r) => r.displayName === gone.displayName)).toBe(false);
    expect(asOwner?.find((r) => r.isYou)?.chatKey).toBeNull();
    expect((await listMembersWithChatKeys(t.as(ravi), groupId))?.every((r) => r.userId === undefined)).toBe(true);
  });

  it("is null for anyone who is not an active member, an unknown group and a malformed id", async () => {
    const { t, zed, gone, mina, groupId } = await crowd();
    for (const who of [zed, gone]) expect(await listMembersWithChatKeys(t.as(who), groupId)).toBeNull();
    expect(await listMembersWithChatKeys(t.as(mina), "not-a-uuid")).toBeNull();
    expect(await listMembersWithChatKeys(t.as(mina), crypto.randomUUID())).toBeNull();
  });
});

describe("private chats and the group chat stay apart", () => {
  it("a private message is not in the group chat, and a group message is not in a private chat or its list", async () => {
    const { t, ravi, mina, groupId } = await crowd();
    const chatId = await open(t, groupId, ravi, mina);
    await sent(t, groupId, chatId, ravi, "whisper");
    const groupDeps = { ...t.as(mina), messages: t.messages };
    expect((await loadGroupChat(groupDeps, groupId))?.messages).toEqual([]);

    expect((await sendGroupMessage(groupDeps, groupId, say("shout"))).ok).toBe(true);
    expect(bodies((await read(t, groupId, chatId, mina)).messages)).toEqual(["whisper"]);
    expect((await listPrivateChats(t.as(mina), groupId))?.chats.map((c) => c.preview)).toEqual(["whisper"]);
    expect(bodies((await loadGroupChat(groupDeps, groupId))!.messages)).toEqual(["shout"]);
    // Private use-cases do not even have the group chat's store.
    expect("messages" in t.as(mina)).toBe(false);
  });
});
