import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeAuthStore } from "@/server/adapters/fake-auth-provider";
import { createFakeGroupStore, resetFakeGroupStore } from "@/server/adapters/fake-group-store";
import { createMemoryRateLimiter } from "@/server/adapters/memory-rate-limiter";
import type { GroupStore } from "@/server/ports/group-store";
import { GROUP_MESSAGES } from "@/shared/group-messages";
import {
  changeJoinSettings,
  deleteGroup,
  getInviteForOwner,
  removeGroupMember,
  resetInvite,
  transferGroupOwnership,
  updateGroupDetails,
} from "./owner-use-cases";
import { verifyGroupPassword } from "./secrets";
import {
  createGroup,
  joinGroup,
  leaveGroup,
  listGroupMembers,
  listMyGroups,
  previewInvite,
  viewGroup,
  type GroupDeps,
  type PreviewDeps,
} from "./use-cases";

const SITE = "https://app.test";
const PASSWORD = "correct horse";
const NEW_PASSWORD = "battery staple";
const COULD_NOT_SAVE = { ok: false, formError: GROUP_MESSAGES.couldNotSave };

function person(name: string) {
  return { id: crypto.randomUUID(), displayName: name };
}

function setup(store?: GroupStore) {
  resetFakeGroupStore();
  const groups = store ?? createFakeGroupStore(createFakeAuthStore());
  let now = 1_000_000;
  const limiter = createMemoryRateLimiter(() => now);
  const advance = (seconds: number) => void (now += seconds * 1000);
  const as = (user: { id: string; displayName: string }, ip = "10.0.0.1"): GroupDeps => ({
    groups,
    limiter,
    siteUrl: SITE,
    ip,
    user,
  });
  const signedOut = (): PreviewDeps => ({ groups, limiter, siteUrl: SITE, ip: "10.0.0.9", user: null });
  return { groups, limiter, advance, as, signedOut };
}

async function make(deps: GroupDeps, raw: unknown) {
  const result = await createGroup(deps, raw);
  if (!result.ok) throw new Error(`createGroup refused: ${JSON.stringify(result)}`);
  return result.data;
}

const passwordGroup = { name: "Chemistry 101", description: "Lab notes", joinMode: "password", password: PASSWORD };
const linkGroup = { name: "Maths club", description: "", joinMode: "link" };

/** An owner with a group, plus a member who joined it. */
async function groupWithMember(raw: unknown = linkGroup) {
  const env = setup();
  const owner = env.as(person("Asha"));
  const member = env.as(person("Ben"));
  const { group, password } = await make(owner, raw);
  const joined = await joinGroup(member, { key: group.inviteCode, password: password ?? undefined });
  if (!joined.ok) throw new Error("member could not join");
  return { ...env, owner, member, group };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("updateGroupDetails", () => {
  it("lets the owner change the name and description, trimmed and validated", async () => {
    const { owner, groups, group } = await groupWithMember();
    const result = await updateGroupDetails(owner, group.id, { name: "  Physics   club ", description: "  Weekly  " });
    expect(result).toEqual({ ok: true, data: undefined });
    const stored = await groups.findById(group.id);
    expect(stored?.name).toBe("Physics club");
    expect(stored?.description).toBe("Weekly");

    const bad = await updateGroupDetails(owner, group.id, { name: "x", description: "" });
    expect(bad).toMatchObject({ ok: false, fieldErrors: { name: expect.any(String) } });
    expect((await groups.findById(group.id))?.name).toBe("Physics club");
  });

  it("refuses a member, a stranger and an unknown or malformed id, and changes nothing", async () => {
    const { member, as, groups, group } = await groupWithMember();
    const stranger = as(person("Cy"));
    for (const deps of [member, stranger]) {
      expect(await updateGroupDetails(deps, group.id, { name: "Hijacked", description: "" })).toEqual(COULD_NOT_SAVE);
    }
    expect(await updateGroupDetails(member, crypto.randomUUID(), { name: "Hijacked", description: "" })).toEqual(
      COULD_NOT_SAVE,
    );
    expect(await updateGroupDetails(member, "not-an-id", { name: "Hijacked", description: "" })).toEqual(COULD_NOT_SAVE);
    expect((await groups.findById(group.id))?.name).toBe("Maths club");
  });

  it("refuses a removed member", async () => {
    const { owner, member, groups, group } = await groupWithMember();
    await groups.removeMember(group.id, member.user.id);
    expect(await updateGroupDetails(member, group.id, { name: "Hijacked", description: "" })).toEqual(COULD_NOT_SAVE);
    expect((await groups.findById(group.id))?.name).toBe("Maths club");
    expect((await updateGroupDetails(owner, group.id, { name: "Fine name", description: "" })).ok).toBe(true);
  });

  it("gives couldNotSave when the store says the group is gone", async () => {
    const { owner, groups, group } = await groupWithMember();
    const gone: GroupStore = { ...groups, updateDetails: vi.fn(async () => false) };
    expect(await updateGroupDetails({ ...owner, groups: gone }, group.id, { name: "Fine name", description: "" })).toEqual(
      COULD_NOT_SAVE,
    );
  });

  it("rate limits edits to 60 an hour per person", async () => {
    const { owner, advance, group } = await groupWithMember();
    for (let i = 0; i < 60; i++) {
      expect((await updateGroupDetails(owner, group.id, { name: `Name ${i}`, description: "" })).ok).toBe(true);
    }
    const sixtyFirst = await updateGroupDetails(owner, group.id, { name: "One more", description: "" });
    expect(sixtyFirst).toMatchObject({ ok: false, formError: GROUP_MESSAGES.tooMany });
    advance(60 * 60 + 1);
    expect((await updateGroupDetails(owner, group.id, { name: "After wait", description: "" })).ok).toBe(true);
  });
});

describe("changeJoinSettings", () => {
  it("switching to link mode removes the stored hash and returns password null", async () => {
    const { owner, groups, group } = await groupWithMember(passwordGroup);
    expect((await groups.findById(group.id))?.passwordHash).toMatch(/^scrypt\$/);
    const result = await changeJoinSettings(owner, group.id, { joinMode: "link", password: "ignored-value" });
    expect(result).toEqual({ ok: true, data: { password: null } });
    const stored = await groups.findById(group.id);
    expect(stored?.joinMode).toBe("link");
    expect(stored?.passwordHash).toBeNull();
  });

  it("switching back to password mode without a password fails on the password field", async () => {
    const { owner, groups, group } = await groupWithMember();
    const result = await changeJoinSettings(owner, group.id, { joinMode: "password" });
    expect(result).toMatchObject({ ok: false, fieldErrors: { password: expect.any(String) } });
    const tooShort = await changeJoinSettings(owner, group.id, { joinMode: "password", password: "abc" });
    expect(tooShort).toMatchObject({ ok: false, fieldErrors: { password: expect.any(String) } });
    const stored = await groups.findById(group.id);
    expect(stored?.joinMode).toBe("link");
    expect(stored?.passwordHash).toBeNull();
  });

  it("sets a password, echoes it once, and stores only a hash that verifies", async () => {
    const { owner, groups, group } = await groupWithMember();
    const result = await changeJoinSettings(owner, group.id, { joinMode: "password", password: NEW_PASSWORD });
    expect(result).toEqual({ ok: true, data: { password: NEW_PASSWORD } });
    const stored = await groups.findById(group.id);
    expect(stored?.joinMode).toBe("password");
    expect(stored?.passwordHash).toMatch(/^scrypt\$/);
    expect(stored?.passwordHash).not.toContain(NEW_PASSWORD);
    expect(await verifyGroupPassword(NEW_PASSWORD, stored?.passwordHash ?? "")).toBe(true);
  });

  it("changing the password keeps every member and the new password works for a new joiner", async () => {
    const { owner, member, as, groups, group } = await groupWithMember(passwordGroup);
    const before = await groups.listMembers(group.id);
    const result = await changeJoinSettings(owner, group.id, { joinMode: "password", password: NEW_PASSWORD });
    expect(result).toEqual({ ok: true, data: { password: NEW_PASSWORD } });
    expect(await groups.listMembers(group.id)).toEqual(before);
    expect(await groups.getMembership(group.id, member.user.id)).toEqual({ role: "member", status: "active" });

    const newcomer = as(person("Dee"));
    const old = await joinGroup(newcomer, { key: group.inviteCode, password: PASSWORD });
    expect(old).toMatchObject({ ok: false, fieldErrors: { password: GROUP_MESSAGES.wrongPassword } });
    expect((await joinGroup(newcomer, { key: group.inviteCode, password: NEW_PASSWORD })).ok).toBe(true);
  });

  it("refuses a member and a stranger, and changes nothing", async () => {
    const { member, as, groups, group } = await groupWithMember(passwordGroup);
    const before = await groups.findById(group.id);
    for (const deps of [member, as(person("Cy"))]) {
      expect(await changeJoinSettings(deps, group.id, { joinMode: "link" })).toEqual(COULD_NOT_SAVE);
    }
    expect(await changeJoinSettings(member, "nope", { joinMode: "link" })).toEqual(COULD_NOT_SAVE);
    expect(await groups.findById(group.id)).toEqual(before);
  });

  it("never logs or returns the hash or password when the store fails with an error that carries them", async () => {
    const { owner, groups, group } = await groupWithMember();
    let seenHash = "";
    const leaky: GroupStore = {
      ...groups,
      updateJoin: vi.fn(async (_id, j) => {
        seenHash = j.passwordHash ?? "";
        throw new Error(`insert failed: hash=${j.passwordHash} password=${NEW_PASSWORD}`);
      }),
    };
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {}),
    );
    const result = await changeJoinSettings({ ...owner, groups: leaky }, group.id, {
      joinMode: "password",
      password: NEW_PASSWORD,
    });
    expect(result).toEqual(COULD_NOT_SAVE);
    expect(seenHash).toMatch(/^scrypt\$/);
    const everything = JSON.stringify([result, ...spies.map((spy) => spy.mock.calls)]);
    expect(everything).not.toContain(seenHash);
    expect(everything).not.toContain(NEW_PASSWORD);
    expect(spies.some((spy) => spy.mock.calls.length > 0)).toBe(true);
  });

  it("gives couldNotSave when the store says the group is gone", async () => {
    const { owner, groups, group } = await groupWithMember();
    const gone: GroupStore = { ...groups, updateJoin: vi.fn(async () => false) };
    expect(await changeJoinSettings({ ...owner, groups: gone }, group.id, { joinMode: "link" })).toEqual(COULD_NOT_SAVE);
  });
});

describe("resetInvite", () => {
  it("returns a new link and code; the old ones stop working and members stay in", async () => {
    const { owner, member, signedOut, as, groups, group } = await groupWithMember();
    const outsider = as(person("Cy"));
    const oldToken = group.inviteUrl.split("/invite/")[1];
    expect((await previewInvite(outsider, oldToken)).state).toBe("open");

    const result = await resetInvite(owner, group.id);
    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(result.data.inviteUrl).toMatch(/^https:\/\/app\.test\/invite\/[A-Za-z0-9_-]{43}$/);
    expect(result.data.inviteUrl).not.toBe(group.inviteUrl);
    expect(result.data.inviteCode).toMatch(/^[2-9A-HJKMNP-Z]{8}$/);
    expect(result.data.inviteCode).not.toBe(group.inviteCode);

    expect(await previewInvite(outsider, oldToken)).toEqual({ state: "invalid" });
    expect(await previewInvite(outsider, group.inviteCode)).toEqual({ state: "invalid" });
    expect(await previewInvite(signedOut(), oldToken)).toEqual({ state: "invalid" });
    const fresh = await previewInvite(outsider, result.data.inviteUrl.split("/invite/")[1]);
    expect(fresh.state).toBe("open");
    expect((await previewInvite(outsider, result.data.inviteCode)).state).toBe("open");

    expect(await groups.getMembership(group.id, member.user.id)).toEqual({ role: "member", status: "active" });
    expect((await previewInvite(member, result.data.inviteCode)).state).toBe("member");
    expect(JSON.stringify(result)).not.toMatch(/scrypt|passwordHash/);
  });

  it("retries when the generated key is taken, then gives up after 5 tries", async () => {
    const { owner, groups, group } = await groupWithMember();
    const real = groups.replaceInvite.bind(groups);
    let calls = 0;
    const flaky: GroupStore = {
      ...groups,
      replaceInvite: vi.fn(async (id, i) => {
        calls += 1;
        return calls <= 2 ? ("invite_taken" as const) : real(id, i);
      }),
    };
    expect((await resetInvite({ ...owner, groups: flaky }, group.id)).ok).toBe(true);
    expect(calls).toBe(3);

    const stuck: GroupStore = { ...groups, replaceInvite: vi.fn(async () => "invite_taken" as const) };
    expect(await resetInvite({ ...owner, groups: stuck }, group.id)).toEqual(COULD_NOT_SAVE);
    expect(stuck.replaceInvite).toHaveBeenCalledTimes(5);
  });

  it("gives couldNotSave and logs a fixed line when the store throws an error carrying the new key", async () => {
    const { owner, groups, group } = await groupWithMember();
    let seenToken = "";
    let seenCode = "";
    const leaky: GroupStore = {
      ...groups,
      replaceInvite: vi.fn(async (_id, i) => {
        seenToken = i.inviteToken;
        seenCode = i.inviteCode;
        throw new Error(`update failed: params ${i.inviteToken}, ${i.inviteCode}`);
      }),
    };
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {}),
    );
    const result = await resetInvite({ ...owner, groups: leaky }, group.id);
    expect(result).toEqual(COULD_NOT_SAVE);
    expect(seenToken).not.toBe("");
    const everything = JSON.stringify([result, ...spies.map((spy) => spy.mock.calls)]);
    expect(everything).not.toContain(seenToken);
    expect(everything).not.toContain(seenCode);
    expect(spies.flatMap((spy) => spy.mock.calls)).toEqual([["Could not reset the invite."]]);
  });

  it("gives couldNotSave, not a thrown error, when the store fails while checking who is asking", async () => {
    const { owner, groups, group } = await groupWithMember();
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {}),
    );
    const down: GroupStore = { ...groups, findById: vi.fn(async () => Promise.reject(new Error(`down ${group.id}`))) };
    const deps = { ...owner, groups: down };
    expect(await resetInvite(deps, group.id)).toEqual(COULD_NOT_SAVE);
    expect(await updateGroupDetails(deps, group.id, { name: "Maths" })).toEqual(COULD_NOT_SAVE);
    expect(await changeJoinSettings(deps, group.id, { joinMode: "link" })).toEqual(COULD_NOT_SAVE);
    expect(JSON.stringify(spies.map((spy) => spy.mock.calls))).not.toContain(group.id);
  });

  it("gives couldNotSave when the group is gone", async () => {
    const { owner, groups, group } = await groupWithMember();
    const gone: GroupStore = { ...groups, replaceInvite: vi.fn(async () => "group_gone" as const) };
    expect(await resetInvite({ ...owner, groups: gone }, group.id)).toEqual(COULD_NOT_SAVE);
  });

  it("refuses a member and a stranger, and the invite stays as it was", async () => {
    const { member, as, groups, group } = await groupWithMember();
    for (const deps of [member, as(person("Cy"))]) {
      expect(await resetInvite(deps, group.id)).toEqual(COULD_NOT_SAVE);
    }
    expect(await resetInvite(member, "nope")).toEqual(COULD_NOT_SAVE);
    expect((await groups.findById(group.id))?.inviteCode).toBe(group.inviteCode);
  });

  it("rate limits resets to 20 an hour per person", async () => {
    const { owner, advance, group } = await groupWithMember();
    for (let i = 0; i < 20; i++) expect((await resetInvite(owner, group.id)).ok).toBe(true);
    const twentyFirst = await resetInvite(owner, group.id);
    expect(twentyFirst).toMatchObject({ ok: false, formError: GROUP_MESSAGES.tooMany });
    expect(twentyFirst.ok === false && twentyFirst.retryAfterSeconds).toBeGreaterThan(0);
    advance(60 * 60 + 1);
    expect((await resetInvite(owner, group.id)).ok).toBe(true);
  });
});

describe("getInviteForOwner", () => {
  it("gives the owner the link, code, join mode and their own name, without the hash", async () => {
    const { owner, group } = await groupWithMember(passwordGroup);
    const invite = await getInviteForOwner(owner, group.id);
    expect(invite).toEqual({
      inviteUrl: group.inviteUrl,
      inviteCode: group.inviteCode,
      joinMode: "password",
      ownerName: "Asha",
    });
    expect(JSON.stringify(invite)).not.toMatch(/scrypt|passwordHash/);
  });

  it("gives null to a member, a stranger, a removed member and a bad id", async () => {
    const { owner, member, as, groups, group } = await groupWithMember();
    expect(await getInviteForOwner(member, group.id)).toBeNull();
    expect(await getInviteForOwner(as(person("Cy")), group.id)).toBeNull();
    expect(await getInviteForOwner(owner, "nope")).toBeNull();
    expect(await getInviteForOwner(owner, crypto.randomUUID())).toBeNull();
    await groups.removeMember(group.id, member.user.id);
    expect(await getInviteForOwner(member, group.id)).toBeNull();
  });
});

/** An owner (Asha) with two members who joined (Ben, Cy). */
async function groupWithTwoMembers() {
  const env = await groupWithMember();
  const second = env.as(person("Cy"));
  const joined = await joinGroup(second, { key: env.group.inviteCode });
  if (!joined.ok) throw new Error("second member could not join");
  return { ...env, second };
}

const tokenOf = (inviteUrl: string) => inviteUrl.split("/invite/")[1];

describe("removeGroupMember", () => {
  it("removes a member and the person can no longer join by token or code", async () => {
    const { owner, member, groups, group, as, signedOut } = await groupWithMember();
    expect(await removeGroupMember(owner, group.id, member.user.id)).toEqual({ ok: true, data: undefined });
    expect(await groups.getMembership(group.id, member.user.id)).toEqual({ role: "member", status: "removed" });

    expect(await joinGroup(member, { key: group.inviteCode })).toEqual({ ok: false, formError: GROUP_MESSAGES.cannotJoin });
    expect(await joinGroup(member, { key: tokenOf(group.inviteUrl) })).toEqual({
      ok: false,
      formError: GROUP_MESSAGES.cannotJoin,
    });
    expect(await previewInvite(member, group.inviteCode)).toEqual({ state: "removed" });
    expect(await previewInvite(member, tokenOf(group.inviteUrl))).toEqual({ state: "removed" });

    expect(await listMyGroups(member)).toEqual([]);
    expect(await viewGroup(member, group.id)).toBeNull();
    expect(await listGroupMembers(member, group.id)).toBeNull();
    expect((await listGroupMembers(owner, group.id))?.map((row) => row.role)).toEqual(["owner"]);
    // Other people are not affected.
    expect((await previewInvite(as(person("Dee")), group.inviteCode)).state).toBe("open");
    expect((await previewInvite(signedOut(), group.inviteCode)).state).toBe("open");
  });

  it("refuses a member, a removed person, a stranger, the owner removing themselves, and a target who is not in the group, without changing anything", async () => {
    const { owner, member, second, as, groups, group } = await groupWithTwoMembers();
    const stranger = as(person("Eve"));
    const removed = as(person("Dee"));
    await joinGroup(removed, { key: group.inviteCode });
    await groups.removeMember(group.id, removed.user.id);
    const left = as(person("Fay"));
    await joinGroup(left, { key: group.inviteCode });
    await leaveGroup(left, group.id);

    const before = await groups.listMembers(group.id);
    // Not allowed to remove anyone.
    for (const deps of [member, removed, stranger]) {
      expect(await removeGroupMember(deps, group.id, second.user.id)).toEqual(COULD_NOT_SAVE);
    }
    // The owner, with targets that are not valid.
    for (const target of [owner.user.id, stranger.user.id, removed.user.id, left.user.id, crypto.randomUUID(), "not-an-id", ""]) {
      expect(await removeGroupMember(owner, group.id, target)).toEqual(COULD_NOT_SAVE);
    }
    // A group that does not exist, or an id that is not one.
    expect(await removeGroupMember(owner, crypto.randomUUID(), second.user.id)).toEqual(COULD_NOT_SAVE);
    expect(await removeGroupMember(owner, "nope", second.user.id)).toEqual(COULD_NOT_SAVE);
    // A store that says no.
    const no: GroupStore = { ...groups, removeMember: vi.fn(async () => false) };
    expect(await removeGroupMember({ ...owner, groups: no }, group.id, second.user.id)).toEqual(COULD_NOT_SAVE);

    expect(await groups.listMembers(group.id)).toEqual(before);
    expect(await groups.getMembership(group.id, second.user.id)).toEqual({ role: "member", status: "active" });
    expect(await groups.getMembership(group.id, owner.user.id)).toEqual({ role: "owner", status: "active" });
    expect(await groups.getMembership(group.id, removed.user.id)).toEqual({ role: "member", status: "removed" });
  });

  it("by a non-owner does not use the owner's rate-limit budget", async () => {
    const { owner, member, second, limiter, group } = await groupWithTwoMembers();
    const hit = vi.spyOn(limiter, "hit");
    for (let i = 0; i < 70; i++) {
      expect(await removeGroupMember(member, group.id, second.user.id)).toEqual(COULD_NOT_SAVE);
    }
    expect(hit).not.toHaveBeenCalled();
    expect((await removeGroupMember(owner, group.id, second.user.id)).ok).toBe(true);
    expect(hit).toHaveBeenCalledTimes(1);
    expect(hit.mock.calls[0][0]).toMatchObject({ key: `group-manage:${owner.user.id}`, limit: 60, windowSeconds: 3600 });
  });
});

describe("transferGroupOwnership", () => {
  it("hands the group over and the previous owner becomes a plain member who can leave", async () => {
    const { owner, member, groups, group } = await groupWithMember();
    expect(await transferGroupOwnership(owner, group.id, { targetUserId: member.user.id })).toEqual({
      ok: true,
      data: undefined,
    });
    expect(await groups.getMembership(group.id, member.user.id)).toEqual({ role: "owner", status: "active" });
    expect(await groups.getMembership(group.id, owner.user.id)).toEqual({ role: "member", status: "active" });
    expect((await groups.listMembers(group.id)).filter((row) => row.role === "owner")).toHaveLength(1);

    // The new owner has the owner tools; the previous owner has none.
    expect(await getInviteForOwner(member, group.id)).not.toBeNull();
    expect(await getInviteForOwner(owner, group.id)).toBeNull();
    expect(await updateGroupDetails(owner, group.id, { name: "Hijacked", description: "" })).toEqual(COULD_NOT_SAVE);
    expect(await resetInvite(owner, group.id)).toEqual(COULD_NOT_SAVE);
    expect(await deleteGroup(owner, group.id, { confirmName: "Maths club" })).toEqual(COULD_NOT_SAVE);
    expect(await transferGroupOwnership(owner, group.id, { targetUserId: member.user.id })).toEqual(COULD_NOT_SAVE);
    expect(await leaveGroup(member, group.id)).toEqual({ ok: false, formError: GROUP_MESSAGES.ownerCannotLeave });

    // The previous owner can leave like any member, and join back later.
    expect(await leaveGroup(owner, group.id)).toEqual({ ok: true, data: undefined });
    expect(await listMyGroups(owner)).toEqual([]);
    expect(await groups.getMembership(group.id, owner.user.id)).toBeNull();
    expect((await joinGroup(owner, { key: group.inviteCode })).ok).toBe(true);
  });

  it("refuses a non-owner and a bad target and keeps the owner", async () => {
    const { owner, member, second, as, groups, group } = await groupWithTwoMembers();
    const stranger = as(person("Eve"));
    const removed = as(person("Dee"));
    await joinGroup(removed, { key: group.inviteCode });
    await groups.removeMember(group.id, removed.user.id);
    const left = as(person("Fay"));
    await joinGroup(left, { key: group.inviteCode });
    await leaveGroup(left, group.id);

    // Non-owners (a member, a removed person, a stranger) get no detail at all.
    for (const deps of [member, removed, stranger]) {
      expect(await transferGroupOwnership(deps, group.id, { targetUserId: second.user.id })).toEqual(COULD_NOT_SAVE);
      expect(await transferGroupOwnership(deps, group.id, { targetUserId: deps.user.id })).toEqual(COULD_NOT_SAVE);
    }
    expect(await transferGroupOwnership(owner, crypto.randomUUID(), { targetUserId: member.user.id })).toEqual(COULD_NOT_SAVE);
    expect(await transferGroupOwnership(owner, "nope", { targetUserId: member.user.id })).toEqual(COULD_NOT_SAVE);

    // Bad targets: the owner picks again.
    const pickAgain = { ok: false, fieldErrors: { targetUserId: GROUP_MESSAGES.transferTargetInvalid } };
    for (const raw of [
      { targetUserId: owner.user.id },
      { targetUserId: stranger.user.id },
      { targetUserId: removed.user.id },
      { targetUserId: left.user.id },
      { targetUserId: crypto.randomUUID() },
      { targetUserId: "not-an-id" },
      {},
    ]) {
      expect(await transferGroupOwnership(owner, group.id, raw)).toEqual(pickAgain);
    }
    expect(await transferGroupOwnership(owner, group.id, null)).toEqual({ ok: false, formError: GROUP_MESSAGES.badForm });

    // Any other answer from the store is couldNotSave.
    for (const answer of ["not_owner", "group_gone"] as const) {
      const odd: GroupStore = { ...groups, transferOwnership: vi.fn(async () => answer) };
      expect(await transferGroupOwnership({ ...owner, groups: odd }, group.id, { targetUserId: member.user.id })).toEqual(
        COULD_NOT_SAVE,
      );
    }

    expect(await groups.getMembership(group.id, owner.user.id)).toEqual({ role: "owner", status: "active" });
    expect(await groups.getMembership(group.id, member.user.id)).toEqual({ role: "member", status: "active" });
    expect(await groups.getMembership(group.id, second.user.id)).toEqual({ role: "member", status: "active" });
  });
});

describe("deleteGroup", () => {
  it("requires the exact name, hides the group everywhere and kills the invite link and code", async () => {
    const { owner, member, as, signedOut, groups, group } = await groupWithMember();
    const outsider = as(person("Cy"));
    const mismatch = { ok: false, fieldErrors: { confirmName: GROUP_MESSAGES.deleteNameMismatch } };
    for (const confirmName of ["maths club", "Maths", "Maths clubs", "Mathsclub", "", "   ", "MATHS CLUB"]) {
      expect(await deleteGroup(owner, group.id, { confirmName })).toEqual(mismatch);
    }
    expect(await deleteGroup(owner, group.id, {})).toEqual(mismatch);
    expect(await groups.findById(group.id)).not.toBeNull();
    expect((await previewInvite(outsider, group.inviteCode)).state).toBe("open");

    // The current name counts: after a rename the old one no longer works.
    await updateGroupDetails(owner, group.id, { name: "Applied  maths", description: "" });
    expect(await deleteGroup(owner, group.id, { confirmName: "Maths club" })).toEqual(mismatch);

    // Spaces around and inside are ignored.
    expect(await deleteGroup(owner, group.id, { confirmName: "  Applied   maths  " })).toEqual({ ok: true, data: undefined });

    expect(await groups.findById(group.id)).toBeNull();
    for (const key of [group.inviteCode, tokenOf(group.inviteUrl)]) {
      expect(await previewInvite(outsider, key)).toEqual({ state: "invalid" });
      expect(await previewInvite(signedOut(), key)).toEqual({ state: "invalid" });
      expect(await previewInvite(member, key)).toEqual({ state: "invalid" });
      expect(await joinGroup(outsider, { key })).toEqual({ ok: false, formError: GROUP_MESSAGES.invalidInvite });
    }
    expect(await viewGroup(owner, group.id)).toBeNull();
    expect(await viewGroup(member, group.id)).toBeNull();
    expect(await listGroupMembers(member, group.id)).toBeNull();
    expect(await listMyGroups(owner)).toEqual([]);
    expect(await listMyGroups(member)).toEqual([]);
    // Nothing more can be done to it, and a second delete is refused.
    expect(await deleteGroup(owner, group.id, { confirmName: "Applied maths" })).toEqual(COULD_NOT_SAVE);
    expect(await updateGroupDetails(owner, group.id, { name: "Back again", description: "" })).toEqual(COULD_NOT_SAVE);
  });

  it("refuses a non-owner and does not reveal whether the group exists", async () => {
    const { owner, member, as, groups, group } = await groupWithMember();
    const stranger = as(person("Eve"));
    const removed = as(person("Dee"));
    await joinGroup(removed, { key: group.inviteCode });
    await groups.removeMember(group.id, removed.user.id);

    for (const deps of [member, removed, stranger]) {
      // Right name and wrong name look the same, so the name cannot be guessed through this.
      expect(await deleteGroup(deps, group.id, { confirmName: "Maths club" })).toEqual(COULD_NOT_SAVE);
      expect(await deleteGroup(deps, group.id, { confirmName: "wrong" })).toEqual(COULD_NOT_SAVE);
      expect(await deleteGroup(deps, group.id, null)).toEqual(COULD_NOT_SAVE);
    }
    expect(await deleteGroup(owner, crypto.randomUUID(), { confirmName: "Maths club" })).toEqual(COULD_NOT_SAVE);
    expect(await deleteGroup(owner, "nope", { confirmName: "Maths club" })).toEqual(COULD_NOT_SAVE);
    expect(await deleteGroup(owner, crypto.randomUUID(), { confirmName: "wrong" })).toEqual(COULD_NOT_SAVE);

    expect(await groups.findById(group.id)).not.toBeNull();
    expect(await listMyGroups(owner)).toHaveLength(1);
    expect(await listMyGroups(member)).toHaveLength(1);
  });

  it("gives couldNotSave when the store says the group is already gone", async () => {
    const { owner, groups, group } = await groupWithMember();
    const gone: GroupStore = { ...groups, softDeleteGroup: vi.fn(async () => false) };
    expect(await deleteGroup({ ...owner, groups: gone }, group.id, { confirmName: "Maths club" })).toEqual(COULD_NOT_SAVE);
  });
});

describe("owner actions together", () => {
  it("share one limit of 60 an hour per person", async () => {
    const { owner, member, advance, groups, group } = await groupWithMember();
    // Each of these passes the checks, reaches the limiter and is then turned down by the store.
    for (let i = 0; i < 60; i++) {
      expect(await transferGroupOwnership(owner, group.id, { targetUserId: crypto.randomUUID() })).toMatchObject({
        fieldErrors: { targetUserId: GROUP_MESSAGES.transferTargetInvalid },
      });
    }
    const results = [
      await transferGroupOwnership(owner, group.id, { targetUserId: member.user.id }),
      await removeGroupMember(owner, group.id, member.user.id),
      await deleteGroup(owner, group.id, { confirmName: "Maths club" }),
    ];
    for (const result of results) {
      expect(result).toMatchObject({ ok: false, formError: GROUP_MESSAGES.tooMany });
      expect(result.ok === false && result.retryAfterSeconds).toBeGreaterThan(0);
    }
    expect(await groups.getMembership(group.id, owner.user.id)).toEqual({ role: "owner", status: "active" });
    expect(await groups.getMembership(group.id, member.user.id)).toEqual({ role: "member", status: "active" });
    expect(await groups.findById(group.id)).not.toBeNull();
    advance(60 * 60 + 1);
    expect((await removeGroupMember(owner, group.id, member.user.id)).ok).toBe(true);
  });
});

describe("a store failure in remove, transfer or delete", () => {
  it("gives couldNotSave and logs only a fixed line", async () => {
    const { owner, member, groups, group } = await groupWithMember();
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {}),
    );
    const leak = `boom ${group.id} ${member.user.id} ${owner.user.id}`;
    const broken: GroupStore = {
      ...groups,
      removeMember: vi.fn(async () => Promise.reject(new Error(leak))),
      transferOwnership: vi.fn(async () => Promise.reject(new Error(leak))),
      softDeleteGroup: vi.fn(async () => Promise.reject(new Error(leak))),
    };
    const deps = { ...owner, groups: broken };
    expect(await removeGroupMember(deps, group.id, member.user.id)).toEqual(COULD_NOT_SAVE);
    expect(await transferGroupOwnership(deps, group.id, { targetUserId: member.user.id })).toEqual(COULD_NOT_SAVE);
    expect(await deleteGroup(deps, group.id, { confirmName: "Maths club" })).toEqual(COULD_NOT_SAVE);
    expect(spies.flatMap((spy) => spy.mock.calls)).toEqual([
      ["Could not remove the member."],
      ["Could not hand over the group."],
      ["Could not delete the group."],
    ]);

    // Also when the store fails while checking who is asking, or who the target is.
    const down: GroupStore = { ...groups, findById: vi.fn(async () => Promise.reject(new Error(leak))) };
    for (const result of [
      await removeGroupMember({ ...owner, groups: down }, group.id, member.user.id),
      await transferGroupOwnership({ ...owner, groups: down }, group.id, { targetUserId: member.user.id }),
      await deleteGroup({ ...owner, groups: down }, group.id, { confirmName: "Maths club" }),
    ]) {
      expect(result).toEqual(COULD_NOT_SAVE);
    }
    const noLookup: GroupStore = {
      ...groups,
      getMembership: vi.fn(async (groupId, userId) => {
        if (userId === member.user.id) throw new Error(leak);
        return groups.getMembership(groupId, userId);
      }),
    };
    expect(await removeGroupMember({ ...owner, groups: noLookup }, group.id, member.user.id)).toEqual(COULD_NOT_SAVE);

    expect(JSON.stringify(spies.map((spy) => spy.mock.calls))).not.toMatch(
      new RegExp(`${group.id}|${member.user.id}|${owner.user.id}|boom`),
    );
    expect(await groups.getMembership(group.id, member.user.id)).toEqual({ role: "member", status: "active" });
    expect(await groups.findById(group.id)).not.toBeNull();
  });
});

describe("listGroupMembers and user ids", () => {
  it("plain members never receive user ids from the member list", async () => {
    const { owner, member, second, group } = await groupWithTwoMembers();
    const asMember = await listGroupMembers(member, group.id);
    expect(asMember).toHaveLength(3);
    const text = JSON.stringify(asMember);
    for (const id of [owner.user.id, member.user.id, second.user.id]) expect(text).not.toContain(id);
    expect(asMember?.every((row) => !("userId" in row))).toBe(true);
    expect(asMember?.map((row) => [row.role, row.isYou])).toEqual([
      ["owner", false],
      ["member", true],
      ["member", false],
    ]);

    // The owner gets ids, to aim a removal.
    const asOwner = await listGroupMembers(owner, group.id);
    expect(asOwner?.map((row) => row.userId)).toEqual([owner.user.id, member.user.id, second.user.id]);
    expect(asOwner?.filter((row) => row.isYou).map((row) => row.userId)).toEqual([owner.user.id]);

    // The previous owner is a plain member after a hand-over: no ids either.
    await transferGroupOwnership(owner, group.id, { targetUserId: member.user.id });
    const afterwards = JSON.stringify(await listGroupMembers(owner, group.id));
    for (const id of [owner.user.id, member.user.id, second.user.id]) expect(afterwards).not.toContain(id);
  });
});
