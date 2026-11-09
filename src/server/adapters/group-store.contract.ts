import { describe, expect, test } from "vitest";
import { GROUP_CODE_ALPHABET, GROUP_LIMITS } from "@/shared/groups";
import type { GroupStore } from "../ports/group-store";

export type GroupStoreContext = {
  store: GroupStore;
  /** A new person, as an account would be; the name is what listMembers shows. */
  newUser(name?: string): Promise<string>;
  /** Many new people in one call, so a test with hundreds stays fast. */
  newUsers(count: number): Promise<string[]>;
};

type WithStore = (run: (ctx: GroupStoreContext) => Promise<void>) => Promise<void>;

/**
 * Behaviour every GroupStore must have. `withStore` sets up a clean store, runs the test body with
 * it, and cleans up, so each implementation keeps its own set-up and clean-up.
 * Calling this registers tests, so call it only from a test file.
 */
export function runGroupStoreContract(withStore: WithStore): void {
  /**
   * Fresh random invite keys: a valid code (codeLength characters of the alphabet) and a token.
   * Random rather than counted, so a rerun or another test worker on the same database (whose
   * groups may still hold earlier keys) does not collide; 31^8 codes make a clash negligible.
   */
  function keys() {
    const bytes = crypto.getRandomValues(new Uint8Array(GROUP_LIMITS.codeLength));
    const inviteCode = Array.from(bytes, (b) => GROUP_CODE_ALPHABET[b % GROUP_CODE_ALPHABET.length]).join("");
    return { inviteToken: `token-${crypto.randomUUID()}`, inviteCode };
  }

  function groupInput(ownerId: string, over: Partial<Parameters<GroupStore["createGroup"]>[0]> = {}) {
    return {
      ownerId,
      name: "Biology revision",
      description: "Cells and genes",
      joinMode: "link" as const,
      passwordHash: null,
      ...keys(),
      ...over,
    };
  }

  async function makeGroup(ctx: GroupStoreContext, ownerId: string, over: Partial<Parameters<GroupStore["createGroup"]>[0]> = {}) {
    const result = await ctx.store.createGroup(groupInput(ownerId, over));
    if (!result.ok) throw new Error(`createGroup failed: ${result.reason}`);
    return result.group;
  }

  describe("GroupStore contract", () => {
    test("creates a group and makes the creator its owner", () =>
      withStore(async (ctx) => {
        const owner = await ctx.newUser("Ada");
        const input = groupInput(owner, { name: "Maths", description: "Algebra", joinMode: "password", passwordHash: "hash" });
        const result = await ctx.store.createGroup(input);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.group).toMatchObject({
          name: "Maths",
          description: "Algebra",
          joinMode: "password",
          passwordHash: "hash",
          inviteToken: input.inviteToken,
          inviteCode: input.inviteCode,
        });
        expect(result.group.id).toEqual(expect.any(String));
        expect(result.group.createdAt).toBeInstanceOf(Date);
        expect(await ctx.store.getMembership(result.group.id, owner)).toEqual({ role: "owner", status: "active" });
        expect(await ctx.store.findById(result.group.id)).toEqual(result.group);
        expect(await ctx.store.findById(crypto.randomUUID())).toBeNull();
      }));

    test("rejects a 21st group for one person", () =>
      withStore(async (ctx) => {
        const owner = await ctx.newUser();
        for (let n = 0; n < GROUP_LIMITS.maxGroupsPerPerson; n++) await makeGroup(ctx, owner);
        const extra = groupInput(owner);
        expect(await ctx.store.createGroup(extra)).toEqual({ ok: false, reason: "too_many_groups" });
        expect(await ctx.store.findByInvite({ token: extra.inviteToken })).toBeNull();
        expect(await ctx.store.listGroupsFor(owner)).toHaveLength(GROUP_LIMITS.maxGroupsPerPerson);
      }));

    test("finds by token and by code, and not a deleted-or-unknown key", () =>
      withStore(async (ctx) => {
        const owner = await ctx.newUser();
        const group = await makeGroup(ctx, owner);
        expect(await ctx.store.findByInvite({ token: group.inviteToken })).toEqual(group);
        expect(await ctx.store.findByInvite({ code: group.inviteCode })).toEqual(group);
        expect(await ctx.store.findByInvite({ token: "no-such-token" })).toBeNull();
        expect(await ctx.store.findByInvite({ code: "ZZZZZZZZ" })).toBeNull();
      }));

    test("adds a member once (second add is already_member)", () =>
      withStore(async (ctx) => {
        const owner = await ctx.newUser();
        const person = await ctx.newUser();
        const group = await makeGroup(ctx, owner);
        expect(await ctx.store.addMember(group.id, person)).toBe("joined");
        expect(await ctx.store.addMember(group.id, person)).toBe("already_member");
        expect(await ctx.store.addMember(group.id, owner)).toBe("already_member");
        expect(await ctx.store.getMembership(group.id, person)).toEqual({ role: "member", status: "active" });
        expect(await ctx.store.getMembership(group.id, await ctx.newUser())).toBeNull();
        expect(await ctx.store.addMember(crypto.randomUUID(), person)).toBe("group_gone");
      }));

    test("refuses the 301st member with full", () =>
      withStore(async (ctx) => {
        const owner = await ctx.newUser();
        const group = await makeGroup(ctx, owner);
        const people = await ctx.newUsers(GROUP_LIMITS.maxMembers - 1);
        for (const person of people.slice(0, -1)) expect(await ctx.store.addMember(group.id, person)).toBe("joined");
        // The owner and 298 members make 299: the last seat goes to the next person.
        expect(await ctx.store.addMember(group.id, people[people.length - 1])).toBe("joined");
        expect(await ctx.store.addMember(group.id, await ctx.newUser())).toBe("full");
        expect(await ctx.store.listMembers(group.id)).toHaveLength(GROUP_LIMITS.maxMembers);
      }));

    test("two adds at the same instant for the last seat give exactly one joined", () =>
      withStore(async (ctx) => {
        const owner = await ctx.newUser();
        const group = await makeGroup(ctx, owner);
        const people = await ctx.newUsers(GROUP_LIMITS.maxMembers - 1);
        for (const person of people.slice(0, -1)) await ctx.store.addMember(group.id, person);
        // The owner and 298 members are in: one seat is left.
        const [a, b] = await ctx.newUsers(2);
        const results = await Promise.all([ctx.store.addMember(group.id, a), ctx.store.addMember(group.id, b)]);
        expect([...results].sort()).toEqual(["full", "joined"]);
        expect(await ctx.store.listMembers(group.id)).toHaveLength(GROUP_LIMITS.maxMembers);

        // The same person twice at once: one joined, one already_member.
        const other = await makeGroup(ctx, owner);
        const person = await ctx.newUser();
        const twice = await Promise.all([ctx.store.addMember(other.id, person), ctx.store.addMember(other.id, person)]);
        expect([...twice].sort()).toEqual(["already_member", "joined"]);
        expect(await ctx.store.listMembers(other.id)).toHaveLength(2);
      }));

    test("a removed person gets removed on add and stays removed", () =>
      withStore(async (ctx) => {
        const owner = await ctx.newUser();
        const person = await ctx.newUser();
        const group = await makeGroup(ctx, owner);
        await ctx.store.addMember(group.id, person);
        expect(await ctx.store.removeMember(group.id, person)).toBe(true);
        expect(await ctx.store.getMembership(group.id, person)).toEqual({ role: "member", status: "removed" });
        expect(await ctx.store.addMember(group.id, person)).toBe("removed");
        expect(await ctx.store.addMember(group.id, person)).toBe("removed");
        // Leaving does not clear a removal.
        expect(await ctx.store.leave(group.id, person)).toBe("not_member");
        expect(await ctx.store.addMember(group.id, person)).toBe("removed");
        expect((await ctx.store.getMembership(group.id, person))?.status).toBe("removed");
      }));

    test("leave deletes the membership, lets the person rejoin, and refuses the owner", () =>
      withStore(async (ctx) => {
        const owner = await ctx.newUser();
        const person = await ctx.newUser();
        const group = await makeGroup(ctx, owner);
        await ctx.store.addMember(group.id, person);
        expect(await ctx.store.leave(group.id, person)).toBe("left");
        expect(await ctx.store.getMembership(group.id, person)).toBeNull();
        expect(await ctx.store.leave(group.id, person)).toBe("not_member");
        expect(await ctx.store.addMember(group.id, person)).toBe("joined");
        expect(await ctx.store.leave(group.id, owner)).toBe("owner");
        expect(await ctx.store.getMembership(group.id, owner)).toEqual({ role: "owner", status: "active" });
        expect(await ctx.store.leave(group.id, await ctx.newUser())).toBe("not_member");
      }));

    test("removeMember refuses the owner and non-members", () =>
      withStore(async (ctx) => {
        const owner = await ctx.newUser();
        const group = await makeGroup(ctx, owner);
        expect(await ctx.store.removeMember(group.id, owner)).toBe(false);
        expect(await ctx.store.removeMember(group.id, await ctx.newUser())).toBe(false);
        expect(await ctx.store.getMembership(group.id, owner)).toEqual({ role: "owner", status: "active" });
      }));

    test("refuses a join when the person is already in 20 groups", () =>
      withStore(async (ctx) => {
        const owner = await ctx.newUser();
        const person = await ctx.newUser();
        const made = [];
        for (let n = 0; n < GROUP_LIMITS.maxGroupsPerPerson; n++) made.push(await makeGroup(ctx, owner, { name: `Group ${n}` }));
        // Someone else owns the group the person then tries to join.
        const extra = await makeGroup(ctx, await ctx.newUser());
        for (const group of made) expect(await ctx.store.addMember(group.id, person)).toBe("joined");
        expect(await ctx.store.addMember(extra.id, person)).toBe("too_many_groups");
        expect(await ctx.store.getMembership(extra.id, person)).toBeNull();
        // Leaving one makes room.
        expect(await ctx.store.leave(made[0].id, person)).toBe("left");
        expect(await ctx.store.addMember(extra.id, person)).toBe("joined");
      }));

    test("listGroupsFor lists only active memberships", () =>
      withStore(async (ctx) => {
        const owner = await ctx.newUser();
        const person = await ctx.newUser();
        const beta = await makeGroup(ctx, owner, { name: "Beta" });
        const alpha = await makeGroup(ctx, owner, { name: "Alpha" });
        const gamma = await makeGroup(ctx, owner, { name: "Gamma" });
        const delta = await makeGroup(ctx, owner, { name: "Delta" });
        for (const group of [beta, alpha, gamma, delta]) await ctx.store.addMember(group.id, person);
        await ctx.store.leave(gamma.id, person);
        await ctx.store.removeMember(delta.id, person);
        expect(await ctx.store.listGroupsFor(person)).toEqual([
          { id: alpha.id, name: "Alpha" },
          { id: beta.id, name: "Beta" },
        ]);
        expect((await ctx.store.listGroupsFor(owner)).map((g) => g.name)).toEqual(["Alpha", "Beta", "Delta", "Gamma"]);
        expect(await ctx.store.listGroupsFor(await ctx.newUser())).toEqual([]);
      }));

    test("listMembers shows names, owner first, active only", () =>
      withStore(async (ctx) => {
        const owner = await ctx.newUser("Olive");
        const first = await ctx.newUser("Bea");
        const second = await ctx.newUser("Cal");
        const gone = await ctx.newUser("Dee");
        const left = await ctx.newUser("Eli");
        const group = await makeGroup(ctx, owner);
        await ctx.store.addMember(group.id, first);
        await ctx.store.addMember(group.id, gone);
        await ctx.store.addMember(group.id, left);
        await ctx.store.addMember(group.id, second);
        await ctx.store.removeMember(group.id, gone);
        await ctx.store.leave(group.id, left);
        const members = await ctx.store.listMembers(group.id);
        expect(members.map((m) => [m.userId, m.displayName, m.role])).toEqual([
          [owner, "Olive", "owner"],
          [first, "Bea", "member"],
          [second, "Cal", "member"],
        ]);
        for (const m of members) expect(m.joinedAt).toBeInstanceOf(Date);
      }));

    test("updateDetails and updateJoin change only their fields", () =>
      withStore(async (ctx) => {
        const owner = await ctx.newUser();
        const group = await makeGroup(ctx, owner, { joinMode: "link", passwordHash: null });
        expect(await ctx.store.updateDetails(group.id, { name: "New name", description: "New text" })).toBe(true);
        expect(await ctx.store.findById(group.id)).toEqual({ ...group, name: "New name", description: "New text" });
        expect(await ctx.store.updateJoin(group.id, { joinMode: "password", passwordHash: "hash-2" })).toBe(true);
        expect(await ctx.store.findById(group.id)).toEqual({
          ...group,
          name: "New name",
          description: "New text",
          joinMode: "password",
          passwordHash: "hash-2",
        });
        expect(await ctx.store.updateDetails(crypto.randomUUID(), { name: "x", description: "" })).toBe(false);
        expect(await ctx.store.updateJoin(crypto.randomUUID(), { joinMode: "link", passwordHash: null })).toBe(false);
      }));

    test("replaceInvite makes the old token and code stop finding the group", () =>
      withStore(async (ctx) => {
        const owner = await ctx.newUser();
        const group = await makeGroup(ctx, owner);
        const next = keys();
        expect(await ctx.store.replaceInvite(group.id, next)).toBe("ok");
        expect(await ctx.store.findByInvite({ token: group.inviteToken })).toBeNull();
        expect(await ctx.store.findByInvite({ code: group.inviteCode })).toBeNull();
        expect(await ctx.store.findByInvite({ token: next.inviteToken })).toMatchObject({ id: group.id });
        expect(await ctx.store.findByInvite({ code: next.inviteCode })).toMatchObject({ id: group.id });
        expect(await ctx.store.replaceInvite(crypto.randomUUID(), keys())).toBe("group_gone");
      }));

    test("invite_taken on a duplicate token or code, with nothing changed", () =>
      withStore(async (ctx) => {
        const owner = await ctx.newUser();
        const first = await makeGroup(ctx, owner);
        const second = await makeGroup(ctx, owner);

        // createGroup: a taken token, then a taken code.
        const sameToken = groupInput(owner, { inviteToken: first.inviteToken });
        expect(await ctx.store.createGroup(sameToken)).toEqual({ ok: false, reason: "invite_taken" });
        expect(await ctx.store.findByInvite({ code: sameToken.inviteCode })).toBeNull();
        const sameCode = groupInput(owner, { inviteCode: first.inviteCode });
        expect(await ctx.store.createGroup(sameCode)).toEqual({ ok: false, reason: "invite_taken" });
        expect(await ctx.store.findByInvite({ token: sameCode.inviteToken })).toBeNull();
        expect(await ctx.store.listGroupsFor(owner)).toHaveLength(2);

        // replaceInvite: a taken token, then a taken code; the group keeps both old keys.
        const fresh = keys();
        expect(await ctx.store.replaceInvite(second.id, { inviteToken: first.inviteToken, inviteCode: fresh.inviteCode })).toBe("invite_taken");
        expect(await ctx.store.replaceInvite(second.id, { inviteToken: fresh.inviteToken, inviteCode: first.inviteCode })).toBe("invite_taken");
        expect(await ctx.store.findById(second.id)).toEqual(second);
        expect(await ctx.store.findByInvite({ code: fresh.inviteCode })).toBeNull();
        expect(await ctx.store.findByInvite({ token: fresh.inviteToken })).toBeNull();
        expect(await ctx.store.findById(first.id)).toEqual(first);
      }));
  });
}
