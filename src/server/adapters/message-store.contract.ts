import { describe, expect, test } from "vitest";
import { CHAT_LIMITS } from "@/shared/messages";
import type { MessageRecord, MessageStore } from "../ports/message-store";

export type MessageStoreContext = {
  store: MessageStore;
  /** A new person, as an account would be; the name is what a message's senderName shows. */
  newUser(name?: string): Promise<string>;
  /** A new group owned by that person; returns its id. */
  newGroup(ownerId: string): Promise<string>;
  /** Soft-deletes the group, as the group store does. */
  deleteGroup(groupId: string): Promise<void>;
  /** Removes the person's account, as deleting a user does (the database clears sender_id). */
  deleteUser(userId: string): Promise<void>;
};

type WithStore = (run: (ctx: MessageStoreContext) => Promise<void>) => Promise<void>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Long enough that two messages never share a creation millisecond, so the order is certain. */
const TICK_MS = 5;

const EMOJI = "\u{1F600}";

/**
 * Behaviour every MessageStore must have. `withStore` sets up a clean store, runs the test body
 * with it, and cleans up, so each implementation keeps its own set-up and clean-up.
 * Calling this registers tests, so call it only from a test file.
 */
export function runMessageStoreContract(withStore: WithStore): void {
  async function setup(ctx: MessageStoreContext) {
    const sender = await ctx.newUser("Ada");
    const groupId = await ctx.newGroup(sender);
    return { sender, groupId };
  }

  /** A message sent a moment after the previous one, with a fresh client id. */
  async function post(ctx: MessageStoreContext, groupId: string, senderId: string, body: string, clientId = crypto.randomUUID()) {
    await sleep(TICK_MS);
    const { message, created } = await ctx.store.send({ groupId, senderId, clientId, body });
    expect(created).toBe(true);
    return message;
  }

  const bodies = (records: MessageRecord[]) => records.map((r) => r.body);
  const ids = (records: MessageRecord[]) => records.map((r) => r.id);
  const EMPTY = { messages: [], hasMore: false };

  /** `count` messages "m1".."m<count>", sent in that order. */
  async function postMany(ctx: MessageStoreContext, groupId: string, senderId: string, count: number) {
    const sent: MessageRecord[] = [];
    for (let n = 1; n <= count; n++) sent.push(await post(ctx, groupId, senderId, `m${n}`));
    return sent;
  }

  describe("MessageStore contract", () => {
    test("send saves a message with the sender's name and a cursor, and it can be found", () =>
      withStore(async (ctx) => {
        const { sender, groupId } = await setup(ctx);
        const clientId = crypto.randomUUID();
        const { message, created } = await ctx.store.send({ groupId, senderId: sender, clientId, body: "hello there" });
        expect(created).toBe(true);
        expect(message).toMatchObject({
          groupId,
          senderId: sender,
          senderName: "Ada",
          body: "hello there",
          clientId,
          deleted: false,
        });
        expect(message.id).toMatch(/^[0-9a-f-]{36}$/);
        expect(message.cursor.length).toBeGreaterThan(10);
        expect(Math.abs(message.createdAt.getTime() - Date.now())).toBeLessThan(600_000);
        expect(await ctx.store.findById(groupId, message.id)).toEqual(message);
        expect((await ctx.store.listLatest(groupId, 10)).messages).toEqual([message]);
      }));

    test("the text is kept as given: line breaks, inner spaces, other scripts and emoji", () =>
      withStore(async (ctx) => {
        const { sender, groupId } = await setup(ctx);
        const body = `  line one\n\nline  two नमस्ते ${EMOJI} <b>&amp;</b> `;
        const message = await post(ctx, groupId, sender, body);
        expect(message.body).toBe(body);
        expect((await ctx.store.findById(groupId, message.id))?.body).toBe(body);
      }));

    test("listLatest gives the newest messages oldest first, and says whether older ones exist", () =>
      withStore(async (ctx) => {
        const { sender, groupId } = await setup(ctx);
        expect(await ctx.store.listLatest(groupId, 5)).toEqual(EMPTY);
        await postMany(ctx, groupId, sender, 5);

        const all = await ctx.store.listLatest(groupId, 5);
        expect(bodies(all.messages)).toEqual(["m1", "m2", "m3", "m4", "m5"]);
        expect(all.hasMore).toBe(false);

        const some = await ctx.store.listLatest(groupId, 3);
        expect(bodies(some.messages)).toEqual(["m3", "m4", "m5"]);
        expect(some.hasMore).toBe(true);

        expect((await ctx.store.listLatest(groupId, 10)).hasMore).toBe(false);
      }));

    test("the limit is clamped to 1..50, and anything that is not a number gets 50", () =>
      withStore(async (ctx) => {
        const { sender, groupId } = await setup(ctx);
        // No pause between these: the database's clock has microseconds and the fake's never repeats.
        for (let n = 1; n <= CHAT_LIMITS.pageSize + 2; n++) {
          await ctx.store.send({ groupId, senderId: sender, clientId: crypto.randomUUID(), body: `n${n}` });
        }
        expect((await ctx.store.listLatest(groupId, 0)).messages).toHaveLength(1);
        expect((await ctx.store.listLatest(groupId, -5)).messages).toHaveLength(1);
        const big = await ctx.store.listLatest(groupId, 1000);
        expect(big.messages).toHaveLength(50);
        expect(big.hasMore).toBe(true);
        expect(big.messages[49].body).toBe("n52");
        expect((await ctx.store.listLatest(groupId, Number.NaN)).messages).toHaveLength(50);
        expect((await ctx.store.listLatest(groupId, 2.9)).messages).toHaveLength(2);
      }));

    test("listBefore walks back through the chat, oldest first within each page, with no gap or repeat", () =>
      withStore(async (ctx) => {
        const { sender, groupId } = await setup(ctx);
        await postMany(ctx, groupId, sender, 7);

        const first = await ctx.store.listLatest(groupId, 3);
        expect(bodies(first.messages)).toEqual(["m5", "m6", "m7"]);
        const second = await ctx.store.listBefore(groupId, first.messages[0].cursor, 3);
        expect(bodies(second.messages)).toEqual(["m2", "m3", "m4"]);
        expect(second.hasMore).toBe(true);
        const third = await ctx.store.listBefore(groupId, second.messages[0].cursor, 3);
        expect(bodies(third.messages)).toEqual(["m1"]);
        expect(third.hasMore).toBe(false);
        expect(await ctx.store.listBefore(groupId, third.messages[0].cursor, 3)).toEqual(EMPTY);
      }));

    test("listBefore with exactly a page left says there is no more", () =>
      withStore(async (ctx) => {
        const { sender, groupId } = await setup(ctx);
        const sent = await postMany(ctx, groupId, sender, 4);
        const page = await ctx.store.listBefore(groupId, sent[3].cursor, 3);
        expect(bodies(page.messages)).toEqual(["m1", "m2", "m3"]);
        expect(page.hasMore).toBe(false);
      }));

    test("listAfter returns what came after the cursor, oldest first, and says whether still more is waiting", () =>
      withStore(async (ctx) => {
        const { sender, groupId } = await setup(ctx);
        const sent = await postMany(ctx, groupId, sender, 6);

        const a = await ctx.store.listAfter(groupId, sent[1].cursor, 3);
        expect(bodies(a.messages)).toEqual(["m3", "m4", "m5"]);
        expect(a.hasMore).toBe(true);
        const b = await ctx.store.listAfter(groupId, a.messages[2].cursor, 3);
        expect(bodies(b.messages)).toEqual(["m6"]);
        expect(b.hasMore).toBe(false);
        // Up to date: nothing, and the same cursor can be asked again.
        expect(await ctx.store.listAfter(groupId, b.messages[0].cursor, 3)).toEqual(EMPTY);

        const exact = await ctx.store.listAfter(groupId, sent[2].cursor, 3);
        expect(bodies(exact.messages)).toEqual(["m4", "m5", "m6"]);
        expect(exact.hasMore).toBe(false);
      }));

    test("polling picks up a message sent after the cursor was taken", () =>
      withStore(async (ctx) => {
        const { sender, groupId } = await setup(ctx);
        const [first] = await postMany(ctx, groupId, sender, 1);
        const newer = await post(ctx, groupId, sender, "later");
        expect((await ctx.store.listAfter(groupId, first.cursor, 10)).messages).toEqual([newer]);
        const newest = await post(ctx, groupId, sender, "latest");
        expect(bodies((await ctx.store.listAfter(groupId, newer.cursor, 10)).messages)).toEqual(["latest"]);
        expect(ids((await ctx.store.listAfter(groupId, first.cursor, 10)).messages)).toEqual([newer.id, newest.id]);
      }));

    test("a cursor that is not one is treated as no cursor: the latest page", () =>
      withStore(async (ctx) => {
        const { sender, groupId } = await setup(ctx);
        const sent = await postMany(ctx, groupId, sender, 4);
        const latestTwo = await ctx.store.listLatest(groupId, 2);
        expect(ids(latestTwo.messages)).toEqual([sent[2].id, sent[3].id]);
        const garbage = ["", "garbage", "!!!", "x".repeat(500), Buffer.from("12:not-an-id").toString("base64url"), "a b", "%00"];
        for (const cursor of garbage) {
          expect(await ctx.store.listAfter(groupId, cursor, 2)).toEqual(latestTwo);
          expect(await ctx.store.listBefore(groupId, cursor, 2)).toEqual(latestTwo);
        }
      }));

    test("another group's cursor is only a position: it never shows that group's messages", () =>
      withStore(async (ctx) => {
        const { sender, groupId } = await setup(ctx);
        const other = await ctx.newGroup(sender);
        const mine = await postMany(ctx, groupId, sender, 2);
        const theirs = await post(ctx, other, sender, "elsewhere");
        const page = await ctx.store.listAfter(groupId, mine[0].cursor, 10);
        expect(bodies(page.messages)).toEqual(["m2"]);
        expect(bodies((await ctx.store.listAfter(groupId, theirs.cursor, 10)).messages)).not.toContain("elsewhere");
        expect(bodies((await ctx.store.listBefore(groupId, theirs.cursor, 10)).messages)).not.toContain("elsewhere");
        expect(bodies((await ctx.store.listLatest(other, 10)).messages)).toEqual(["elsewhere"]);
      }));

    test("a repeated client id saves nothing new and returns the first message", () =>
      withStore(async (ctx) => {
        const { sender, groupId } = await setup(ctx);
        const clientId = crypto.randomUUID();
        const first = await ctx.store.send({ groupId, senderId: sender, clientId, body: "once" });
        expect(first.created).toBe(true);
        const again = await ctx.store.send({ groupId, senderId: sender, clientId, body: "once" });
        expect(again).toEqual({ message: first.message, created: false });
        // Even a different body: the first message stands.
        const changed = await ctx.store.send({ groupId, senderId: sender, clientId, body: "twice" });
        expect(changed).toEqual({ message: first.message, created: false });
        expect(bodies((await ctx.store.listLatest(groupId, 10)).messages)).toEqual(["once"]);
      }));

    test("sends with one client id at the same moment save one message", () =>
      withStore(async (ctx) => {
        const { sender, groupId } = await setup(ctx);
        const clientId = crypto.randomUUID();
        const results = await Promise.all(
          Array.from({ length: 5 }, () => ctx.store.send({ groupId, senderId: sender, clientId, body: "race" })),
        );
        expect(results.filter((r) => r.created)).toHaveLength(1);
        expect(new Set(results.map((r) => r.message.id)).size).toBe(1);
        expect((await ctx.store.listLatest(groupId, 10)).messages).toHaveLength(1);
      }));

    test("a client id is only taken within its own group, and a repeat by another person returns the first message", () =>
      withStore(async (ctx) => {
        const { sender, groupId } = await setup(ctx);
        const other = await ctx.newGroup(sender);
        const clientId = crypto.randomUUID();
        const a = await ctx.store.send({ groupId, senderId: sender, clientId, body: "here" });
        const b = await ctx.store.send({ groupId: other, senderId: sender, clientId, body: "there" });
        expect(a.created && b.created).toBe(true);
        expect(a.message.id).not.toBe(b.message.id);

        const second = await ctx.newUser("Ravi");
        const clash = await ctx.store.send({ groupId, senderId: second, clientId, body: "mine now" });
        expect(clash.created).toBe(false);
        expect(clash.message.id).toBe(a.message.id);
        expect(clash.message.senderId).toBe(sender);
      }));

    test("a deleted message is hidden from every read and cannot be found or deleted again", () =>
      withStore(async (ctx) => {
        const { sender, groupId } = await setup(ctx);
        const sent = await postMany(ctx, groupId, sender, 3);
        const removed = await ctx.store.softDelete(groupId, sent[1].id);
        expect(removed).toMatchObject({ id: sent[1].id, body: "m2", deleted: true });

        expect(bodies((await ctx.store.listLatest(groupId, 10)).messages)).toEqual(["m1", "m3"]);
        expect(bodies((await ctx.store.listAfter(groupId, sent[0].cursor, 10)).messages)).toEqual(["m3"]);
        expect(bodies((await ctx.store.listBefore(groupId, sent[2].cursor, 10)).messages)).toEqual(["m1"]);
        // A cursor that points at a deleted message still works as a position.
        expect(bodies((await ctx.store.listAfter(groupId, sent[1].cursor, 10)).messages)).toEqual(["m3"]);
        expect(bodies((await ctx.store.listBefore(groupId, sent[1].cursor, 10)).messages)).toEqual(["m1"]);
        expect(await ctx.store.findById(groupId, sent[1].id)).toBeNull();
        expect(await ctx.store.softDelete(groupId, sent[1].id)).toBeNull();
      }));

    test("deleted messages do not count against hasMore", () =>
      withStore(async (ctx) => {
        const { sender, groupId } = await setup(ctx);
        const sent = await postMany(ctx, groupId, sender, 3);
        await ctx.store.softDelete(groupId, sent[0].id);
        const page = await ctx.store.listLatest(groupId, 2);
        expect(bodies(page.messages)).toEqual(["m2", "m3"]);
        expect(page.hasMore).toBe(false);
      }));

    test("a retried send of a deleted message returns it as deleted and does not bring it back", () =>
      withStore(async (ctx) => {
        const { sender, groupId } = await setup(ctx);
        const clientId = crypto.randomUUID();
        const first = await ctx.store.send({ groupId, senderId: sender, clientId, body: "oops" });
        await ctx.store.softDelete(groupId, first.message.id);
        const retry = await ctx.store.send({ groupId, senderId: sender, clientId, body: "oops" });
        expect(retry.created).toBe(false);
        expect(retry.message).toMatchObject({ id: first.message.id, deleted: true });
        expect((await ctx.store.listLatest(groupId, 10)).messages).toEqual([]);
        expect(await ctx.store.findById(groupId, first.message.id)).toBeNull();
      }));

    test("softDelete and findById find nothing for an unknown id, a malformed id, or another group's message", () =>
      withStore(async (ctx) => {
        const { sender, groupId } = await setup(ctx);
        const other = await ctx.newGroup(sender);
        const message = await post(ctx, groupId, sender, "mine");
        for (const id of [crypto.randomUUID(), "not-a-uuid", "", message.id.slice(0, 35)]) {
          expect(await ctx.store.findById(groupId, id)).toBeNull();
          expect(await ctx.store.softDelete(groupId, id)).toBeNull();
        }
        expect(await ctx.store.findById(other, message.id)).toBeNull();
        expect(await ctx.store.softDelete(other, message.id)).toBeNull();
        expect(await ctx.store.findById("not-a-uuid", message.id)).toBeNull();
        expect(await ctx.store.softDelete("not-a-uuid", message.id)).toBeNull();
        // Still there.
        expect(await ctx.store.findById(groupId, message.id)).toEqual(message);
        // Ids match in any letter case.
        expect((await ctx.store.findById(groupId.toUpperCase(), message.id.toUpperCase()))?.id).toBe(message.id);
      }));

    test("messages stay in their own group's chat", () =>
      withStore(async (ctx) => {
        const { sender, groupId } = await setup(ctx);
        const other = await ctx.newGroup(sender);
        await post(ctx, groupId, sender, "a1");
        await post(ctx, other, sender, "b1");
        await post(ctx, groupId, sender, "a2");
        expect(bodies((await ctx.store.listLatest(groupId, 10)).messages)).toEqual(["a1", "a2"]);
        expect(bodies((await ctx.store.listLatest(other, 10)).messages)).toEqual(["b1"]);
      }));

    test("a deleted group's chat cannot be read, found, deleted from, or written to", () =>
      withStore(async (ctx) => {
        const { sender, groupId } = await setup(ctx);
        const [first, second] = await postMany(ctx, groupId, sender, 2);
        await ctx.deleteGroup(groupId);
        expect(await ctx.store.listLatest(groupId, 10)).toEqual(EMPTY);
        expect(await ctx.store.listAfter(groupId, first.cursor, 10)).toEqual(EMPTY);
        expect(await ctx.store.listBefore(groupId, second.cursor, 10)).toEqual(EMPTY);
        expect(await ctx.store.findById(groupId, first.id)).toBeNull();
        expect(await ctx.store.softDelete(groupId, first.id)).toBeNull();
        await expect(ctx.store.send({ groupId, senderId: sender, clientId: crypto.randomUUID(), body: "late" })).rejects.toThrow();
        // Not even a repeat of an earlier send gets through.
        await expect(ctx.store.send({ groupId, senderId: sender, clientId: first.clientId, body: first.body })).rejects.toThrow();
      }));

    test("a message from a former member stays and shows no name and no sender", () =>
      withStore(async (ctx) => {
        const owner = await ctx.newUser("Owner");
        const leaver = await ctx.newUser("Leaver");
        const groupId = await ctx.newGroup(owner);
        const kept = await post(ctx, groupId, leaver, "I was here");
        expect(kept.senderName).toBe("Leaver");
        await post(ctx, groupId, owner, "still here");
        await ctx.deleteUser(leaver);

        const found = await ctx.store.findById(groupId, kept.id);
        expect(found).toMatchObject({ body: "I was here", senderId: null, senderName: "" });
        // The cursor does not change when the account goes.
        expect(found?.cursor).toBe(kept.cursor);
        const page = await ctx.store.listLatest(groupId, 10);
        expect(page.messages.map((m) => [m.body, m.senderName])).toEqual([
          ["I was here", ""],
          ["still here", "Owner"],
        ]);
      }));

    test("the body must be 1 to 2000 characters after trimming spaces", () =>
      withStore(async (ctx) => {
        const { sender, groupId } = await setup(ctx);
        const send = (body: string) => ctx.store.send({ groupId, senderId: sender, clientId: crypto.randomUUID(), body });
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
        const { sender, groupId } = await setup(ctx);
        const clientId = crypto.randomUUID();
        await expect(ctx.store.send({ groupId, senderId: sender, clientId, body: "ab\u0000cd" })).rejects.toThrow();
        await expect(ctx.store.send({ groupId, senderId: sender, clientId, body: "\u0000" })).rejects.toThrow();
        expect((await ctx.store.listLatest(groupId, 10)).messages).toEqual([]);
        // The client id was not used up.
        expect((await ctx.store.send({ groupId, senderId: sender, clientId, body: "fine" })).created).toBe(true);
      }));

    test("send refuses ids that are not uuids, an unknown group, and a sender with no account", () =>
      withStore(async (ctx) => {
        const { sender, groupId } = await setup(ctx);
        const ok = { groupId, senderId: sender, clientId: crypto.randomUUID(), body: "hi" };
        await expect(ctx.store.send({ ...ok, groupId: "nope" })).rejects.toThrow();
        await expect(ctx.store.send({ ...ok, senderId: "nope" })).rejects.toThrow();
        await expect(ctx.store.send({ ...ok, clientId: "nope" })).rejects.toThrow();
        await expect(ctx.store.send({ ...ok, groupId: crypto.randomUUID() })).rejects.toThrow();
        await expect(ctx.store.send({ ...ok, senderId: crypto.randomUUID() })).rejects.toThrow();
        expect((await ctx.store.listLatest(groupId, 10)).messages).toEqual([]);
      }));

    test("the reads find nothing for a malformed or unknown group", () =>
      withStore(async (ctx) => {
        const { sender, groupId } = await setup(ctx);
        const message = await post(ctx, groupId, sender, "x");
        for (const id of ["nope", "", crypto.randomUUID()]) {
          expect(await ctx.store.listLatest(id, 10)).toEqual(EMPTY);
          expect(await ctx.store.listAfter(id, message.cursor, 10)).toEqual(EMPTY);
          expect(await ctx.store.listBefore(id, message.cursor, 10)).toEqual(EMPTY);
        }
      }));
  });
}
