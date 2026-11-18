import { describe, expect, test } from "vitest";
import { CHAT_LIMITS } from "@/shared/messages";
import type { DirectChatStore, DirectMessageRecord } from "../ports/direct-chat-store";

export type DirectChatStoreContext = {
  store: DirectChatStore;
  /** A new person, as an account would be; the name is what a message's senderName and a list's otherName show. */
  newUser(name?: string): Promise<string>;
  /** A new group owned by that person; returns its id. */
  newGroup(ownerId: string): Promise<string>;
  /** Soft-deletes the group, as the group store does. */
  deleteGroup(groupId: string): Promise<void>;
  /** Removes the person's account, as deleting a user does (the database cascades their private chats). */
  deleteUser(userId: string): Promise<void>;
};

type WithStore = (run: (ctx: DirectChatStoreContext) => Promise<void>) => Promise<void>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Long enough that two messages never share a creation millisecond, so the order is certain. */
const TICK_MS = 5;

const EMOJI = "\u{1F600}";

const bodies = (records: DirectMessageRecord[]) => records.map((r) => r.body);
const ids = (records: DirectMessageRecord[]) => records.map((r) => r.id);
const EMPTY = { messages: [], hasMore: false };

/**
 * Behaviour every DirectChatStore must have. `withStore` sets up a clean store, runs the test body
 * with it, and cleans up, so each implementation keeps its own set-up and clean-up.
 * Calling this registers tests, so call it only from a test file.
 */
export function runDirectChatStoreContract(withStore: WithStore): void {
  /** Two people, a group and their chat. */
  async function setup(ctx: DirectChatStoreContext) {
    const ada = await ctx.newUser("Ada");
    const ravi = await ctx.newUser("Ravi");
    const groupId = await ctx.newGroup(ada);
    const { chatId } = await ctx.store.openChat(groupId, ada, ravi);
    return { ada, ravi, groupId, chatId };
  }

  /** A message sent a moment after the previous one, with a fresh client id. */
  async function post(ctx: DirectChatStoreContext, chatId: string, senderId: string, body: string, clientId = crypto.randomUUID()) {
    await sleep(TICK_MS);
    const { message, created } = await ctx.store.send({ chatId, senderId, clientId, body });
    expect(created).toBe(true);
    return message;
  }

  /** `count` messages "m1".."m<count>" from one sender, in that order. */
  async function postMany(ctx: DirectChatStoreContext, chatId: string, senderId: string, count: number) {
    const sent: DirectMessageRecord[] = [];
    for (let n = 1; n <= count; n++) sent.push(await post(ctx, chatId, senderId, `m${n}`));
    return sent;
  }

  describe("DirectChatStore contract: chats", () => {
    test("openChat makes one chat per pair and group, whichever person is named first", () =>
      withStore(async (ctx) => {
        const { ada, ravi, groupId, chatId } = await setup(ctx);
        expect(chatId).toMatch(/^[0-9a-f-]{36}$/);
        expect(await ctx.store.openChat(groupId, ada, ravi)).toEqual({ chatId });
        expect(await ctx.store.openChat(groupId, ravi, ada)).toEqual({ chatId });
        // Ids match in any letter case.
        expect(await ctx.store.openChat(groupId.toUpperCase(), ravi.toUpperCase(), ada.toUpperCase())).toEqual({ chatId });
      }));

    test("the pair is stored in order: the smaller id is first, as lower-case text", () =>
      withStore(async (ctx) => {
        const { ada, ravi, groupId, chatId } = await setup(ctx);
        const found = await ctx.store.findChat(groupId, chatId);
        expect(found).toEqual({ id: chatId, participants: [ada, ravi].sort() });
        const [low, high] = found!.participants;
        expect(low < high).toBe(true);
        // The order does not depend on who opened it.
        const other = await ctx.newGroup(ada);
        const second = await ctx.store.openChat(other, ravi, ada);
        expect((await ctx.store.findChat(other, second.chatId))?.participants).toEqual([low, high]);
      }));

    test("the same two people have a different chat in each group, and a third person has their own", () =>
      withStore(async (ctx) => {
        const { ada, ravi, groupId, chatId } = await setup(ctx);
        const other = await ctx.newGroup(ada);
        const elsewhere = await ctx.store.openChat(other, ada, ravi);
        expect(elsewhere.chatId).not.toBe(chatId);
        const mina = await ctx.newUser("Mina");
        const third = await ctx.store.openChat(groupId, ada, mina);
        expect(third.chatId).not.toBe(chatId);
        expect((await ctx.store.findChat(groupId, third.chatId))?.participants).toEqual([ada, mina].sort());
      }));

    test("opening at the same moment makes one chat", () =>
      withStore(async (ctx) => {
        const ada = await ctx.newUser("Ada");
        const ravi = await ctx.newUser("Ravi");
        const groupId = await ctx.newGroup(ada);
        const results = await Promise.all(
          Array.from({ length: 8 }, (_, i) => (i % 2 === 0 ? ctx.store.openChat(groupId, ada, ravi) : ctx.store.openChat(groupId, ravi, ada))),
        );
        expect(new Set(results.map((r) => r.chatId)).size).toBe(1);
      }));

    test("openChat refuses a deleted or unknown group, the same person twice, bad ids and a person with no account", () =>
      withStore(async (ctx) => {
        const { ada, ravi, groupId } = await setup(ctx);
        await expect(ctx.store.openChat(groupId, ada, ada)).rejects.toThrow();
        await expect(ctx.store.openChat(groupId, ada, ada.toUpperCase())).rejects.toThrow();
        await expect(ctx.store.openChat("nope", ada, ravi)).rejects.toThrow();
        await expect(ctx.store.openChat(groupId, "nope", ravi)).rejects.toThrow();
        await expect(ctx.store.openChat(groupId, ada, "nope")).rejects.toThrow();
        await expect(ctx.store.openChat(crypto.randomUUID(), ada, ravi)).rejects.toThrow();
        await expect(ctx.store.openChat(groupId, ada, crypto.randomUUID())).rejects.toThrow();
        await ctx.deleteGroup(groupId);
        await expect(ctx.store.openChat(groupId, ada, ravi)).rejects.toThrow();
      }));

    test("findChat finds a chat only under its own group", () =>
      withStore(async (ctx) => {
        const { ada, groupId, chatId } = await setup(ctx);
        const other = await ctx.newGroup(ada);
        expect(await ctx.store.findChat(other, chatId)).toBeNull();
        for (const id of ["nope", "", crypto.randomUUID(), chatId.slice(0, 35), `${chatId}0`]) {
          expect(await ctx.store.findChat(groupId, id)).toBeNull();
        }
        for (const id of ["nope", "", crypto.randomUUID()]) expect(await ctx.store.findChat(id, chatId)).toBeNull();
        expect((await ctx.store.findChat(groupId.toUpperCase(), chatId.toUpperCase()))?.id).toBe(chatId);
      }));

    test("a deleted group's chats cannot be found, listed, read or written to", () =>
      withStore(async (ctx) => {
        const { ada, ravi, groupId, chatId } = await setup(ctx);
        const [first] = await postMany(ctx, chatId, ada, 2);
        await ctx.deleteGroup(groupId);
        expect(await ctx.store.findChat(groupId, chatId)).toBeNull();
        expect(await ctx.store.listChatsFor(groupId, ada)).toEqual([]);
        expect(await ctx.store.listChatsFor(groupId, ravi)).toEqual([]);
        expect(await ctx.store.listLatest(chatId, 10)).toEqual(EMPTY);
        expect(await ctx.store.listAfter(chatId, first.cursor, 10)).toEqual(EMPTY);
        expect(await ctx.store.listBefore(chatId, first.cursor, 10)).toEqual(EMPTY);
        expect(await ctx.store.findMessageById(chatId, first.id)).toBeNull();
        expect(await ctx.store.softDelete(chatId, first.id)).toBeNull();
        expect(await ctx.store.unreadSummary(groupId, ravi)).toEqual({ any: false, fromUserIds: [] });
        await expect(ctx.store.send({ chatId, senderId: ada, clientId: crypto.randomUUID(), body: "late" })).rejects.toThrow();
        // Not even a repeat of an earlier send gets through.
        await expect(ctx.store.send({ chatId, senderId: ada, clientId: first.clientId, body: first.body })).rejects.toThrow();
      }));

    test("deleting an account takes its private chats and messages with it", () =>
      withStore(async (ctx) => {
        const { ada, ravi, groupId, chatId } = await setup(ctx);
        const mina = await ctx.newUser("Mina");
        const keep = await ctx.store.openChat(groupId, ada, mina);
        const kept = await post(ctx, keep.chatId, mina, "still here");
        const gone = await post(ctx, chatId, ravi, "bye");
        await ctx.deleteUser(ravi);
        expect(await ctx.store.findChat(groupId, chatId)).toBeNull();
        expect(await ctx.store.listLatest(chatId, 10)).toEqual(EMPTY);
        expect(await ctx.store.findMessageById(chatId, gone.id)).toBeNull();
        // The other chat is untouched.
        expect((await ctx.store.listChatsFor(groupId, ada)).map((c) => c.chatId)).toEqual([keep.chatId]);
        expect(await ctx.store.findMessageById(keep.chatId, kept.id)).not.toBeNull();
      }));
  });

  describe("DirectChatStore contract: the list of chats", () => {
    test("a chat with no message is hidden from both people until one is written", () =>
      withStore(async (ctx) => {
        const { ada, ravi, groupId, chatId } = await setup(ctx);
        expect(await ctx.store.listChatsFor(groupId, ada)).toEqual([]);
        expect(await ctx.store.listChatsFor(groupId, ravi)).toEqual([]);
        expect(await ctx.store.unreadSummary(groupId, ravi)).toEqual({ any: false, fromUserIds: [] });
        const message = await post(ctx, chatId, ada, "hello");
        for (const who of [ada, ravi]) expect((await ctx.store.listChatsFor(groupId, who)).map((c) => c.chatId)).toEqual([chatId]);
        await ctx.store.softDelete(chatId, message.id);
        // Only deleted messages left: hidden again.
        expect(await ctx.store.listChatsFor(groupId, ada)).toEqual([]);
        expect(await ctx.store.listChatsFor(groupId, ravi)).toEqual([]);
      }));

    test("each person sees the OTHER person, the newest message that is not deleted, and its time", () =>
      withStore(async (ctx) => {
        const { ada, ravi, groupId, chatId } = await setup(ctx);
        await post(ctx, chatId, ada, "first");
        const second = await post(ctx, chatId, ravi, "second");
        const third = await post(ctx, chatId, ada, "third");
        await ctx.store.softDelete(chatId, third.id);

        const [mine] = await ctx.store.listChatsFor(groupId, ada);
        expect(mine).toMatchObject({ chatId, otherUserId: ravi, otherName: "Ravi", lastBody: "second" });
        expect(mine.lastAt).toEqual(second.createdAt);
        const [theirs] = await ctx.store.listChatsFor(groupId, ravi);
        expect(theirs).toMatchObject({ chatId, otherUserId: ada, otherName: "Ada", lastBody: "second" });
      }));

    test("lastBody is cut to 80 characters people see, and kept whole below that", () =>
      withStore(async (ctx) => {
        const { ada, groupId, chatId } = await setup(ctx);
        await post(ctx, chatId, ada, EMOJI.repeat(100));
        expect([...(await ctx.store.listChatsFor(groupId, ada))[0].lastBody]).toHaveLength(80);
        await post(ctx, chatId, ada, "y".repeat(80));
        expect((await ctx.store.listChatsFor(groupId, ada))[0].lastBody).toBe("y".repeat(80));
        await post(ctx, chatId, ada, "x".repeat(81));
        expect((await ctx.store.listChatsFor(groupId, ada))[0].lastBody).toBe("x".repeat(80));
        await post(ctx, chatId, ada, "short\nwith a break");
        expect((await ctx.store.listChatsFor(groupId, ada))[0].lastBody).toBe("short\nwith a break");
      }));

    test("chats come newest message first and only the person's own chats and group's are listed", () =>
      withStore(async (ctx) => {
        const { ada, ravi, groupId, chatId: withRavi } = await setup(ctx);
        const mina = await ctx.newUser("Mina");
        const zoe = await ctx.newUser("Zoe");
        const withMina = (await ctx.store.openChat(groupId, ada, mina)).chatId;
        const withZoe = (await ctx.store.openChat(groupId, zoe, ada)).chatId;
        const between = (await ctx.store.openChat(groupId, ravi, mina)).chatId;
        const otherGroup = await ctx.newGroup(ada);
        const elsewhere = (await ctx.store.openChat(otherGroup, ada, ravi)).chatId;

        await post(ctx, withRavi, ada, "to Ravi");
        await post(ctx, withMina, mina, "from Mina");
        await post(ctx, between, ravi, "Ravi and Mina");
        await post(ctx, elsewhere, ada, "other group");
        await post(ctx, withRavi, ravi, "Ravi again");

        expect((await ctx.store.listChatsFor(groupId, ada)).map((c) => c.chatId)).toEqual([withRavi, withMina]);
        expect((await ctx.store.listChatsFor(groupId, mina)).map((c) => c.chatId)).toEqual([between, withMina]);
        expect((await ctx.store.listChatsFor(groupId, zoe)).map((c) => c.chatId)).toEqual([]);
        expect((await ctx.store.listChatsFor(otherGroup, ada)).map((c) => c.chatId)).toEqual([elsewhere]);
        // A person is never shown a chat they are not in, nor the lastBody of one.
        const bystander = await ctx.newUser("Bystander");
        expect(await ctx.store.listChatsFor(groupId, bystander)).toEqual([]);
        expect(withZoe).not.toBe(withRavi);
      }));

    test("listChatsFor finds nothing for a malformed or unknown group or person", () =>
      withStore(async (ctx) => {
        const { ada, groupId } = await setup(ctx);
        await post(ctx, (await ctx.store.openChat(groupId, ada, await ctx.newUser())).chatId, ada, "x");
        for (const id of ["nope", "", crypto.randomUUID()]) {
          expect(await ctx.store.listChatsFor(id, ada)).toEqual([]);
          expect(await ctx.store.listChatsFor(groupId, id)).toEqual([]);
          expect(await ctx.store.unreadSummary(id, ada)).toEqual({ any: false, fromUserIds: [] });
          expect(await ctx.store.unreadSummary(groupId, id)).toEqual({ any: false, fromUserIds: [] });
        }
      }));
  });

  describe("DirectChatStore contract: messages", () => {
    test("send saves a message with the sender's name and a cursor, and it can be found", () =>
      withStore(async (ctx) => {
        const { ada, chatId } = await setup(ctx);
        const clientId = crypto.randomUUID();
        const { message, created } = await ctx.store.send({ chatId, senderId: ada, clientId, body: "hello there" });
        expect(created).toBe(true);
        expect(message).toMatchObject({ chatId, senderId: ada, senderName: "Ada", body: "hello there", clientId, deleted: false });
        expect(message.id).toMatch(/^[0-9a-f-]{36}$/);
        expect(message.cursor.length).toBeGreaterThan(10);
        expect(Math.abs(message.createdAt.getTime() - Date.now())).toBeLessThan(600_000);
        expect(await ctx.store.findMessageById(chatId, message.id)).toEqual(message);
        expect((await ctx.store.listLatest(chatId, 10)).messages).toEqual([message]);
      }));

    test("the text is kept as given: line breaks, inner spaces, other scripts and emoji", () =>
      withStore(async (ctx) => {
        const { ada, chatId } = await setup(ctx);
        const body = `  line one\n\nline  two नमस्ते ${EMOJI} <b>&amp;</b> `;
        const message = await post(ctx, chatId, ada, body);
        expect(message.body).toBe(body);
        expect((await ctx.store.findMessageById(chatId, message.id))?.body).toBe(body);
      }));

    test("either of the two people can write, each under their own name", () =>
      withStore(async (ctx) => {
        const { ada, ravi, chatId } = await setup(ctx);
        await post(ctx, chatId, ada, "one");
        await post(ctx, chatId, ravi, "two");
        const page = await ctx.store.listLatest(chatId, 10);
        expect(page.messages.map((m) => [m.body, m.senderName, m.senderId])).toEqual([
          ["one", "Ada", ada],
          ["two", "Ravi", ravi],
        ]);
      }));

    test("only the chat's two people can send, whatever else is true of them, and nothing is saved", () =>
      withStore(async (ctx) => {
        const { ada, chatId } = await setup(ctx);
        const mina = await ctx.newUser("Mina");
        const ok = { chatId, senderId: ada, clientId: crypto.randomUUID(), body: "hi" };
        await expect(ctx.store.send({ ...ok, senderId: mina })).rejects.toThrow();
        await expect(ctx.store.send({ ...ok, senderId: crypto.randomUUID() })).rejects.toThrow();
        // Not even a repeat of someone else's client id gets a stranger the message back.
        const sent = await ctx.store.send(ok);
        await expect(ctx.store.send({ ...ok, senderId: mina })).rejects.toThrow();
        expect((await ctx.store.listLatest(chatId, 10)).messages).toEqual([sent.message]);
      }));

    test("listLatest gives the newest messages oldest first, and says whether older ones exist", () =>
      withStore(async (ctx) => {
        const { ada, chatId } = await setup(ctx);
        expect(await ctx.store.listLatest(chatId, 5)).toEqual(EMPTY);
        await postMany(ctx, chatId, ada, 5);

        const all = await ctx.store.listLatest(chatId, 5);
        expect(bodies(all.messages)).toEqual(["m1", "m2", "m3", "m4", "m5"]);
        expect(all.hasMore).toBe(false);

        const some = await ctx.store.listLatest(chatId, 3);
        expect(bodies(some.messages)).toEqual(["m3", "m4", "m5"]);
        expect(some.hasMore).toBe(true);
        expect((await ctx.store.listLatest(chatId, 10)).hasMore).toBe(false);
      }));

    test("the limit is clamped to 1..50, and anything that is not a number gets 50", () =>
      withStore(async (ctx) => {
        const { ada, chatId } = await setup(ctx);
        // No pause between these: the database's clock has microseconds and the fake's never repeats.
        for (let n = 1; n <= CHAT_LIMITS.pageSize + 2; n++) {
          await ctx.store.send({ chatId, senderId: ada, clientId: crypto.randomUUID(), body: `n${n}` });
        }
        expect((await ctx.store.listLatest(chatId, 0)).messages).toHaveLength(1);
        expect((await ctx.store.listLatest(chatId, -5)).messages).toHaveLength(1);
        const big = await ctx.store.listLatest(chatId, 1000);
        expect(big.messages).toHaveLength(50);
        expect(big.hasMore).toBe(true);
        expect(big.messages[49].body).toBe("n52");
        expect((await ctx.store.listLatest(chatId, Number.NaN)).messages).toHaveLength(50);
        expect((await ctx.store.listLatest(chatId, 2.9)).messages).toHaveLength(2);
      }));

    test("listBefore walks back through the chat, oldest first within each page, with no gap or repeat", () =>
      withStore(async (ctx) => {
        const { ada, chatId } = await setup(ctx);
        await postMany(ctx, chatId, ada, 7);
        const first = await ctx.store.listLatest(chatId, 3);
        expect(bodies(first.messages)).toEqual(["m5", "m6", "m7"]);
        const second = await ctx.store.listBefore(chatId, first.messages[0].cursor, 3);
        expect(bodies(second.messages)).toEqual(["m2", "m3", "m4"]);
        expect(second.hasMore).toBe(true);
        const third = await ctx.store.listBefore(chatId, second.messages[0].cursor, 3);
        expect(bodies(third.messages)).toEqual(["m1"]);
        expect(third.hasMore).toBe(false);
        expect(await ctx.store.listBefore(chatId, third.messages[0].cursor, 3)).toEqual(EMPTY);
      }));

    test("listBefore with exactly a page left says there is no more", () =>
      withStore(async (ctx) => {
        const { ada, chatId } = await setup(ctx);
        const sent = await postMany(ctx, chatId, ada, 4);
        const page = await ctx.store.listBefore(chatId, sent[3].cursor, 3);
        expect(bodies(page.messages)).toEqual(["m1", "m2", "m3"]);
        expect(page.hasMore).toBe(false);
      }));

    test("listAfter returns what came after the cursor, oldest first, and says whether still more is waiting", () =>
      withStore(async (ctx) => {
        const { ada, chatId } = await setup(ctx);
        const sent = await postMany(ctx, chatId, ada, 6);
        const a = await ctx.store.listAfter(chatId, sent[1].cursor, 3);
        expect(bodies(a.messages)).toEqual(["m3", "m4", "m5"]);
        expect(a.hasMore).toBe(true);
        const b = await ctx.store.listAfter(chatId, a.messages[2].cursor, 3);
        expect(bodies(b.messages)).toEqual(["m6"]);
        expect(b.hasMore).toBe(false);
        // Up to date: nothing, and the same cursor can be asked again.
        expect(await ctx.store.listAfter(chatId, b.messages[0].cursor, 3)).toEqual(EMPTY);
        const exact = await ctx.store.listAfter(chatId, sent[2].cursor, 3);
        expect(bodies(exact.messages)).toEqual(["m4", "m5", "m6"]);
        expect(exact.hasMore).toBe(false);
      }));

    test("polling picks up a message sent after the cursor was taken", () =>
      withStore(async (ctx) => {
        const { ada, ravi, chatId } = await setup(ctx);
        const [first] = await postMany(ctx, chatId, ada, 1);
        const newer = await post(ctx, chatId, ravi, "later");
        expect((await ctx.store.listAfter(chatId, first.cursor, 10)).messages).toEqual([newer]);
        const newest = await post(ctx, chatId, ada, "latest");
        expect(bodies((await ctx.store.listAfter(chatId, newer.cursor, 10)).messages)).toEqual(["latest"]);
        expect(ids((await ctx.store.listAfter(chatId, first.cursor, 10)).messages)).toEqual([newer.id, newest.id]);
      }));

    test("a cursor that is not one is treated as no cursor: the latest page", () =>
      withStore(async (ctx) => {
        const { ada, chatId } = await setup(ctx);
        const sent = await postMany(ctx, chatId, ada, 4);
        const latestTwo = await ctx.store.listLatest(chatId, 2);
        expect(ids(latestTwo.messages)).toEqual([sent[2].id, sent[3].id]);
        const garbage = ["", "garbage", "!!!", "x".repeat(500), Buffer.from("12:not-an-id").toString("base64url"), "a b", "%00"];
        for (const cursor of garbage) {
          expect(await ctx.store.listAfter(chatId, cursor, 2)).toEqual(latestTwo);
          expect(await ctx.store.listBefore(chatId, cursor, 2)).toEqual(latestTwo);
        }
      }));

    test("another chat's cursor is only a position: it never shows that chat's messages", () =>
      withStore(async (ctx) => {
        const { ada, ravi, groupId, chatId } = await setup(ctx);
        const mina = await ctx.newUser("Mina");
        const other = (await ctx.store.openChat(groupId, ada, mina)).chatId;
        const mine = await postMany(ctx, chatId, ada, 2);
        const theirs = await post(ctx, other, mina, "elsewhere");
        expect(bodies((await ctx.store.listAfter(chatId, mine[0].cursor, 10)).messages)).toEqual(["m2"]);
        expect(bodies((await ctx.store.listAfter(chatId, theirs.cursor, 10)).messages)).not.toContain("elsewhere");
        expect(bodies((await ctx.store.listBefore(chatId, theirs.cursor, 10)).messages)).not.toContain("elsewhere");
        expect(bodies((await ctx.store.listLatest(other, 10)).messages)).toEqual(["elsewhere"]);
        expect(ravi).not.toBe(mina);
      }));

    test("messages stay in their own chat, also between chats of one group and of one pair in two groups", () =>
      withStore(async (ctx) => {
        const { ada, ravi, groupId, chatId } = await setup(ctx);
        const mina = await ctx.newUser("Mina");
        const withMina = (await ctx.store.openChat(groupId, ada, mina)).chatId;
        const otherGroup = await ctx.newGroup(ada);
        const samePair = (await ctx.store.openChat(otherGroup, ada, ravi)).chatId;
        await post(ctx, chatId, ada, "a1");
        await post(ctx, withMina, ada, "b1");
        await post(ctx, samePair, ada, "c1");
        await post(ctx, chatId, ravi, "a2");
        expect(bodies((await ctx.store.listLatest(chatId, 10)).messages)).toEqual(["a1", "a2"]);
        expect(bodies((await ctx.store.listLatest(withMina, 10)).messages)).toEqual(["b1"]);
        expect(bodies((await ctx.store.listLatest(samePair, 10)).messages)).toEqual(["c1"]);
      }));

    test("a repeated client id saves nothing new and returns the first message", () =>
      withStore(async (ctx) => {
        const { ada, chatId } = await setup(ctx);
        const clientId = crypto.randomUUID();
        const first = await ctx.store.send({ chatId, senderId: ada, clientId, body: "once" });
        expect(first.created).toBe(true);
        expect(await ctx.store.send({ chatId, senderId: ada, clientId, body: "once" })).toEqual({ message: first.message, created: false });
        // Even a different body: the first message stands.
        expect(await ctx.store.send({ chatId, senderId: ada, clientId, body: "twice" })).toEqual({ message: first.message, created: false });
        expect(bodies((await ctx.store.listLatest(chatId, 10)).messages)).toEqual(["once"]);
      }));

    test("sends with one client id at the same moment save one message", () =>
      withStore(async (ctx) => {
        const { ada, chatId } = await setup(ctx);
        const clientId = crypto.randomUUID();
        const results = await Promise.all(Array.from({ length: 5 }, () => ctx.store.send({ chatId, senderId: ada, clientId, body: "race" })));
        expect(results.filter((r) => r.created)).toHaveLength(1);
        expect(new Set(results.map((r) => r.message.id)).size).toBe(1);
        expect((await ctx.store.listLatest(chatId, 10)).messages).toHaveLength(1);
      }));

    test("a client id is only taken within its own chat, and the other person repeating it gets the first message", () =>
      withStore(async (ctx) => {
        const { ada, ravi, groupId, chatId } = await setup(ctx);
        const mina = await ctx.newUser("Mina");
        const other = (await ctx.store.openChat(groupId, ada, mina)).chatId;
        const clientId = crypto.randomUUID();
        const a = await ctx.store.send({ chatId, senderId: ada, clientId, body: "here" });
        const b = await ctx.store.send({ chatId: other, senderId: ada, clientId, body: "there" });
        expect(a.created && b.created).toBe(true);
        expect(a.message.id).not.toBe(b.message.id);
        const clash = await ctx.store.send({ chatId, senderId: ravi, clientId, body: "mine now" });
        expect(clash.created).toBe(false);
        expect(clash.message.id).toBe(a.message.id);
        expect(clash.message.senderId).toBe(ada);
      }));

    test("a deleted message is hidden from every read and cannot be found or deleted again", () =>
      withStore(async (ctx) => {
        const { ada, chatId } = await setup(ctx);
        const sent = await postMany(ctx, chatId, ada, 3);
        const removed = await ctx.store.softDelete(chatId, sent[1].id);
        expect(removed).toMatchObject({ id: sent[1].id, body: "m2", deleted: true });

        expect(bodies((await ctx.store.listLatest(chatId, 10)).messages)).toEqual(["m1", "m3"]);
        expect(bodies((await ctx.store.listAfter(chatId, sent[0].cursor, 10)).messages)).toEqual(["m3"]);
        expect(bodies((await ctx.store.listBefore(chatId, sent[2].cursor, 10)).messages)).toEqual(["m1"]);
        // A cursor that points at a deleted message still works as a position.
        expect(bodies((await ctx.store.listAfter(chatId, sent[1].cursor, 10)).messages)).toEqual(["m3"]);
        expect(bodies((await ctx.store.listBefore(chatId, sent[1].cursor, 10)).messages)).toEqual(["m1"]);
        expect(await ctx.store.findMessageById(chatId, sent[1].id)).toBeNull();
        expect(await ctx.store.softDelete(chatId, sent[1].id)).toBeNull();
      }));

    test("deleted messages do not count against hasMore", () =>
      withStore(async (ctx) => {
        const { ada, chatId } = await setup(ctx);
        const sent = await postMany(ctx, chatId, ada, 3);
        await ctx.store.softDelete(chatId, sent[0].id);
        const page = await ctx.store.listLatest(chatId, 2);
        expect(bodies(page.messages)).toEqual(["m2", "m3"]);
        expect(page.hasMore).toBe(false);
      }));

    test("a retried send of a deleted message returns it as deleted and does not bring it back", () =>
      withStore(async (ctx) => {
        const { ada, chatId } = await setup(ctx);
        const clientId = crypto.randomUUID();
        const first = await ctx.store.send({ chatId, senderId: ada, clientId, body: "oops" });
        await ctx.store.softDelete(chatId, first.message.id);
        const retry = await ctx.store.send({ chatId, senderId: ada, clientId, body: "oops" });
        expect(retry.created).toBe(false);
        expect(retry.message).toMatchObject({ id: first.message.id, deleted: true });
        expect((await ctx.store.listLatest(chatId, 10)).messages).toEqual([]);
        expect(await ctx.store.findMessageById(chatId, first.message.id)).toBeNull();
      }));

    test("softDelete and findMessageById find nothing for an unknown id, a malformed id, or another chat's message", () =>
      withStore(async (ctx) => {
        const { ada, groupId, chatId } = await setup(ctx);
        const mina = await ctx.newUser("Mina");
        const other = (await ctx.store.openChat(groupId, ada, mina)).chatId;
        const message = await post(ctx, chatId, ada, "mine");
        for (const id of [crypto.randomUUID(), "not-a-uuid", "", message.id.slice(0, 35)]) {
          expect(await ctx.store.findMessageById(chatId, id)).toBeNull();
          expect(await ctx.store.softDelete(chatId, id)).toBeNull();
        }
        expect(await ctx.store.findMessageById(other, message.id)).toBeNull();
        expect(await ctx.store.softDelete(other, message.id)).toBeNull();
        expect(await ctx.store.findMessageById("not-a-uuid", message.id)).toBeNull();
        expect(await ctx.store.softDelete("not-a-uuid", message.id)).toBeNull();
        expect(await ctx.store.findMessageById(chatId, message.id)).toEqual(message);
        // Ids match in any letter case.
        expect((await ctx.store.findMessageById(chatId.toUpperCase(), message.id.toUpperCase()))?.id).toBe(message.id);
      }));

    test("the body must be 1 to 2000 characters after trimming spaces", () =>
      withStore(async (ctx) => {
        const { ada, chatId } = await setup(ctx);
        const send = (body: string) => ctx.store.send({ chatId, senderId: ada, clientId: crypto.randomUUID(), body });
        await expect(send("")).rejects.toThrow();
        await expect(send("   ")).rejects.toThrow();
        await expect(send("x".repeat(CHAT_LIMITS.maxBody + 1))).rejects.toThrow();
        await expect(send(EMOJI.repeat(CHAT_LIMITS.maxBody + 1))).rejects.toThrow();

        expect((await send("x")).created).toBe(true);
        expect((await send("x".repeat(CHAT_LIMITS.maxBody))).message.body).toHaveLength(CHAT_LIMITS.maxBody);
        // Characters people see are counted, not UTF-16 units: 2000 emoji fit.
        expect([...(await send(EMOJI.repeat(CHAT_LIMITS.maxBody))).message.body]).toHaveLength(CHAT_LIMITS.maxBody);
        // Spaces around the text do not count toward the limit.
        expect((await send(`  ${"y".repeat(CHAT_LIMITS.maxBody)}  `)).created).toBe(true);
      }));

    test("a NUL character in the body is refused, and nothing is saved", () =>
      withStore(async (ctx) => {
        const { ada, chatId } = await setup(ctx);
        const clientId = crypto.randomUUID();
        await expect(ctx.store.send({ chatId, senderId: ada, clientId, body: "ab\u0000cd" })).rejects.toThrow();
        await expect(ctx.store.send({ chatId, senderId: ada, clientId, body: "\u0000" })).rejects.toThrow();
        expect((await ctx.store.listLatest(chatId, 10)).messages).toEqual([]);
        // The client id was not used up.
        expect((await ctx.store.send({ chatId, senderId: ada, clientId, body: "fine" })).created).toBe(true);
      }));

    test("send refuses ids that are not uuids and an unknown chat", () =>
      withStore(async (ctx) => {
        const { ada, chatId } = await setup(ctx);
        const ok = { chatId, senderId: ada, clientId: crypto.randomUUID(), body: "hi" };
        await expect(ctx.store.send({ ...ok, chatId: "nope" })).rejects.toThrow();
        await expect(ctx.store.send({ ...ok, senderId: "nope" })).rejects.toThrow();
        await expect(ctx.store.send({ ...ok, clientId: "nope" })).rejects.toThrow();
        await expect(ctx.store.send({ ...ok, chatId: crypto.randomUUID() })).rejects.toThrow();
        expect((await ctx.store.listLatest(chatId, 10)).messages).toEqual([]);
      }));

    test("the reads find nothing for a malformed or unknown chat", () =>
      withStore(async (ctx) => {
        const { ada, chatId } = await setup(ctx);
        const message = await post(ctx, chatId, ada, "x");
        for (const id of ["nope", "", crypto.randomUUID()]) {
          expect(await ctx.store.listLatest(id, 10)).toEqual(EMPTY);
          expect(await ctx.store.listAfter(id, message.cursor, 10)).toEqual(EMPTY);
          expect(await ctx.store.listBefore(id, message.cursor, 10)).toEqual(EMPTY);
        }
      }));
  });

  describe("DirectChatStore contract: read positions and unread", () => {
    test("a message from the other person is unread until the reader's position passes it; their own never is", () =>
      withStore(async (ctx) => {
        const { ada, ravi, groupId, chatId } = await setup(ctx);
        const [m1, m2] = await postMany(ctx, chatId, ada, 2);
        // Ravi has not read; Ada wrote them herself.
        expect((await ctx.store.listChatsFor(groupId, ravi))[0].unread).toBe(true);
        expect((await ctx.store.listChatsFor(groupId, ada))[0].unread).toBe(false);
        expect(await ctx.store.unreadSummary(groupId, ravi)).toEqual({ any: true, fromUserIds: [ada] });
        expect(await ctx.store.unreadSummary(groupId, ada)).toEqual({ any: false, fromUserIds: [] });

        await ctx.store.markRead(chatId, ravi, m1.cursor);
        expect((await ctx.store.listChatsFor(groupId, ravi))[0].unread).toBe(true);
        await ctx.store.markRead(chatId, ravi, m2.cursor);
        expect((await ctx.store.listChatsFor(groupId, ravi))[0].unread).toBe(false);
        expect(await ctx.store.unreadSummary(groupId, ravi)).toEqual({ any: false, fromUserIds: [] });

        // A newer message flags it again, for the reader only.
        await post(ctx, chatId, ada, "m3");
        expect((await ctx.store.listChatsFor(groupId, ravi))[0].unread).toBe(true);
        expect(await ctx.store.unreadSummary(groupId, ravi)).toEqual({ any: true, fromUserIds: [ada] });
        expect((await ctx.store.listChatsFor(groupId, ada))[0].unread).toBe(false);
      }));

    test("markRead only moves forward", () =>
      withStore(async (ctx) => {
        const { ada, ravi, groupId, chatId } = await setup(ctx);
        const [m1, m2, m3] = await postMany(ctx, chatId, ada, 3);
        await ctx.store.markRead(chatId, ravi, m2.cursor);
        // Going back to an older position changes nothing, and repeating the same one does not either.
        await ctx.store.markRead(chatId, ravi, m1.cursor);
        await ctx.store.markRead(chatId, ravi, m2.cursor);
        const list = await ctx.store.listChatsFor(groupId, ravi);
        expect(list[0].unread).toBe(true);
        await ctx.store.markRead(chatId, ravi, m3.cursor);
        expect((await ctx.store.listChatsFor(groupId, ravi))[0].unread).toBe(false);
        // Now an older cursor must not bring the dot back.
        await ctx.store.markRead(chatId, ravi, m1.cursor);
        await ctx.store.markRead(chatId, ravi, m2.cursor);
        expect((await ctx.store.listChatsFor(groupId, ravi))[0].unread).toBe(false);
        expect(await ctx.store.unreadSummary(groupId, ravi)).toEqual({ any: false, fromUserIds: [] });
      }));

    test("each person has their own position", () =>
      withStore(async (ctx) => {
        const { ada, ravi, groupId, chatId } = await setup(ctx);
        await post(ctx, chatId, ada, "from Ada");
        const reply = await post(ctx, chatId, ravi, "from Ravi");
        await ctx.store.markRead(chatId, ravi, reply.cursor);
        // Ravi's position says nothing about Ada's.
        expect((await ctx.store.listChatsFor(groupId, ada))[0].unread).toBe(true);
        expect((await ctx.store.listChatsFor(groupId, ravi))[0].unread).toBe(false);
        await ctx.store.markRead(chatId, ada, reply.cursor);
        expect((await ctx.store.listChatsFor(groupId, ada))[0].unread).toBe(false);
      }));

    test("a deleted message is not unread", () =>
      withStore(async (ctx) => {
        const { ada, ravi, groupId, chatId } = await setup(ctx);
        const m1 = await post(ctx, chatId, ada, "old");
        const m2 = await post(ctx, chatId, ada, "oops");
        await ctx.store.markRead(chatId, ravi, m1.cursor);
        expect((await ctx.store.listChatsFor(groupId, ravi))[0].unread).toBe(true);
        await ctx.store.softDelete(chatId, m2.id);
        expect((await ctx.store.listChatsFor(groupId, ravi))[0].unread).toBe(false);
        expect(await ctx.store.unreadSummary(groupId, ravi)).toEqual({ any: false, fromUserIds: [] });
      }));

    test("a position can name a message that is deleted later: it is still only a position", () =>
      withStore(async (ctx) => {
        const { ada, ravi, groupId, chatId } = await setup(ctx);
        const m1 = await post(ctx, chatId, ada, "one");
        await ctx.store.markRead(chatId, ravi, m1.cursor);
        await ctx.store.softDelete(chatId, m1.id);
        await post(ctx, chatId, ada, "two");
        expect((await ctx.store.listChatsFor(groupId, ravi))[0].unread).toBe(true);
      }));

    test("markRead does nothing for a cursor that is not one, an unknown chat, a malformed id or a person outside the chat", () =>
      withStore(async (ctx) => {
        const { ada, ravi, groupId, chatId } = await setup(ctx);
        const mina = await ctx.newUser("Mina");
        const message = await post(ctx, chatId, ada, "hello");
        for (const cursor of ["", "garbage", "!!!", "x".repeat(500), Buffer.from("12:not-an-id").toString("base64url")]) {
          await ctx.store.markRead(chatId, ravi, cursor);
        }
        await ctx.store.markRead(crypto.randomUUID(), ravi, message.cursor);
        await ctx.store.markRead("nope", ravi, message.cursor);
        await ctx.store.markRead(chatId, "nope", message.cursor);
        await ctx.store.markRead(chatId, crypto.randomUUID(), message.cursor);
        await ctx.store.markRead(chatId, mina, message.cursor);
        expect((await ctx.store.listChatsFor(groupId, ravi))[0].unread).toBe(true);
        // The person outside the chat has nothing: no chat, no dot.
        expect(await ctx.store.listChatsFor(groupId, mina)).toEqual([]);
        expect(await ctx.store.unreadSummary(groupId, mina)).toEqual({ any: false, fromUserIds: [] });
      }));

    test("unreadSummary names each other person once, only in this group, and skips chats with no message", () =>
      withStore(async (ctx) => {
        const { ada, ravi, groupId, chatId } = await setup(ctx);
        const mina = await ctx.newUser("Mina");
        const withMina = (await ctx.store.openChat(groupId, ada, mina)).chatId;
        const silent = await ctx.newUser("Silent");
        await ctx.store.openChat(groupId, ada, silent);
        const otherGroup = await ctx.newGroup(ada);
        const elsewhere = (await ctx.store.openChat(otherGroup, ada, ravi)).chatId;

        await postMany(ctx, chatId, ravi, 3);
        await post(ctx, withMina, mina, "hi");
        await post(ctx, elsewhere, ravi, "other group");

        const summary = await ctx.store.unreadSummary(groupId, ada);
        expect(summary.any).toBe(true);
        expect([...summary.fromUserIds].sort()).toEqual([ravi, mina].sort());
        expect(await ctx.store.unreadSummary(otherGroup, ada)).toEqual({ any: true, fromUserIds: [ravi] });
        // Ravi sees nothing from Ada: she wrote nothing.
        expect(await ctx.store.unreadSummary(groupId, ravi)).toEqual({ any: false, fromUserIds: [] });
        // Reading one chat clears only that person.
        const latest = (await ctx.store.listLatest(chatId, 1)).messages[0];
        await ctx.store.markRead(chatId, ada, latest.cursor);
        expect(await ctx.store.unreadSummary(groupId, ada)).toEqual({ any: true, fromUserIds: [mina] });
      }));
  });
}
