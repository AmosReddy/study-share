import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeAuthStore } from "@/server/adapters/fake-auth-provider";
import { createFakeGroupStore, resetFakeGroupStore } from "@/server/adapters/fake-group-store";
import { createMemoryRateLimiter } from "@/server/adapters/memory-rate-limiter";
import type { GroupStore } from "@/server/ports/group-store";
import { GROUP_MESSAGES } from "@/shared/group-messages";
import { changeJoinSettings, getInviteForOwner, resetInvite, updateGroupDetails } from "./owner-use-cases";
import { verifyGroupPassword } from "./secrets";
import { createGroup, joinGroup, previewInvite, type GroupDeps, type PreviewDeps } from "./use-cases";

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
