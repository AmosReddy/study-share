import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeAuthStore } from "@/server/adapters/fake-auth-provider";
import { createFakeGroupStore, resetFakeGroupStore } from "@/server/adapters/fake-group-store";
import { createMemoryRateLimiter } from "@/server/adapters/memory-rate-limiter";
import type { GroupStore } from "@/server/ports/group-store";
import { GROUP_MESSAGES } from "@/shared/group-messages";
import { GROUP_LIMITS } from "@/shared/groups";
import { newGroupCode, newInviteToken, verifyGroupPassword } from "./secrets";
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

vi.mock("./secrets", async (importOriginal) => {
  const original = await importOriginal<typeof import("./secrets")>();
  return { ...original, verifyGroupPassword: vi.fn(original.verifyGroupPassword) };
});

const SITE = "https://app.test";
const PASSWORD = "correct horse";

function person(name: string) {
  return { id: crypto.randomUUID(), displayName: name };
}

/** One shared store and limiter on a test clock; `as(user)` gives that person's deps. */
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
  const signedOut = (ip = "10.0.0.1"): PreviewDeps => ({ groups, limiter, siteUrl: SITE, ip, user: null });
  return { groups, limiter, advance, as, signedOut };
}

const passwordGroup = { name: "Chemistry 101", description: "", joinMode: "password", password: PASSWORD };
const linkGroup = { name: "Maths club", description: "", joinMode: "link" };

/** Creates a group through the use-case and returns what it handed back, failing the test if it refused. */
async function make(deps: GroupDeps, raw: unknown = linkGroup) {
  const result = await createGroup(deps, raw);
  if (!result.ok) throw new Error(`createGroup refused: ${JSON.stringify(result)}`);
  return result.data;
}

/** Direct store seeding that skips the use-case rate limits. */
async function seedGroup(groups: GroupStore, ownerId: string, name = "Seed") {
  const result = await groups.createGroup({
    ownerId,
    name,
    description: "",
    joinMode: "link",
    passwordHash: null,
    inviteToken: newInviteToken(),
    inviteCode: newGroupCode(),
  });
  if (!result.ok) throw new Error(result.reason);
  return result.group;
}

describe("createGroup", () => {
  it("createGroup in password mode returns the link, the code and the password once, and stores only a hash", async () => {
    const { as, groups } = setup();
    const owner = as(person("Asha"));
    const { group, password } = await make(owner, passwordGroup);

    expect(password).toBe(PASSWORD);
    expect(group.joinMode).toBe("password");
    expect(group.inviteUrl).toMatch(/^https:\/\/app\.test\/invite\/[A-Za-z0-9_-]{43}$/);
    expect(group.inviteCode).toMatch(/^[2-9A-HJKMNP-Z]{8}$/);
    expect(JSON.stringify(group)).not.toContain(PASSWORD);

    const stored = await groups.findById(group.id);
    expect(stored?.passwordHash).toMatch(/^scrypt\$/);
    expect(stored?.passwordHash).not.toContain(PASSWORD);
    expect(group.inviteUrl.endsWith(`/invite/${stored?.inviteToken}`)).toBe(true);
    expect(group.inviteCode).toBe(stored?.inviteCode);
    expect(await listMyGroups(owner)).toEqual([{ id: group.id, name: "Chemistry 101" }]);
  });

  it("createGroup in link mode returns password null", async () => {
    const { as, groups } = setup();
    const { group, password } = await make(as(person("Asha")), { ...linkGroup, password: "ignored-value" });
    expect(password).toBeNull();
    expect((await groups.findById(group.id))?.passwordHash).toBeNull();
  });

  it("createGroup returns field errors for a bad form and does not count it", async () => {
    const { as } = setup();
    const result = await createGroup(as(person("Asha")), { name: "x", joinMode: "password", password: "abc" });
    expect(result).toMatchObject({ ok: false, fieldErrors: { name: expect.any(String), password: expect.any(String) } });
    expect(await createGroup(as(person("Asha")), null)).toEqual({ ok: false, formError: GROUP_MESSAGES.badForm });
  });

  it("createGroup refuses a 21st group with the tooManyGroups message", async () => {
    const { as, groups } = setup();
    const owner = as(person("Asha"));
    for (let i = 0; i < GROUP_LIMITS.maxGroupsPerPerson; i++) await seedGroup(groups, owner.user.id, `Group ${i}`);
    const result = await createGroup(owner, linkGroup);
    expect(result).toEqual({ ok: false, formError: GROUP_MESSAGES.tooManyGroups });
  });

  it("createGroup retries when the generated code is taken", async () => {
    const { groups, as } = setup();
    const real = groups.createGroup.bind(groups);
    let calls = 0;
    const flaky: GroupStore = {
      ...groups,
      createGroup: vi.fn(async (input) => {
        calls += 1;
        return calls <= 2 ? ({ ok: false, reason: "invite_taken" } as const) : real(input);
      }),
    };
    const owner = { ...as(person("Asha")), groups: flaky };
    const result = await createGroup(owner, linkGroup);
    expect(result.ok).toBe(true);
    expect(calls).toBe(3);
  });

  it("createGroup gives couldNotSave when every generated key is taken", async () => {
    const { groups, as } = setup();
    const stuck: GroupStore = { ...groups, createGroup: vi.fn(async () => ({ ok: false, reason: "invite_taken" }) as const) };
    const result = await createGroup({ ...as(person("Asha")), groups: stuck }, linkGroup);
    expect(result).toEqual({ ok: false, formError: GROUP_MESSAGES.couldNotSave });
  });

  it("createGroup rate limit refuses the 11th in an hour", async () => {
    const { as, advance } = setup();
    const owner = as(person("Asha"));
    // 10 an hour; the group cap is 20, so ten real groups fit.
    for (let i = 0; i < 10; i++) await make(owner, { ...linkGroup, name: `Group ${i}` });
    const eleventh = await createGroup(owner, linkGroup);
    expect(eleventh).toMatchObject({ ok: false, formError: GROUP_MESSAGES.tooMany });
    expect(eleventh.ok === false && eleventh.retryAfterSeconds).toBeGreaterThan(0);
    advance(60 * 60 + 1);
    expect((await createGroup(owner, linkGroup)).ok).toBe(true);
  });
});

describe("previewInvite", () => {
  it("previewInvite gives invalid for an unknown, reset or deleted key, with the same result for each", async () => {
    const { as, groups, signedOut } = setup();
    const owner = as(person("Asha"));
    const { group } = await make(owner);
    const stored = (await groups.findById(group.id))!;
    const oldToken = stored.inviteToken;
    const oldCode = stored.inviteCode;
    expect(await groups.replaceInvite(group.id, { inviteToken: newInviteToken(), inviteCode: newGroupCode() })).toBe("ok");

    const gone: GroupStore = { ...groups, findByInvite: async () => null }; // what a deleted group looks like to the port
    const results = [
      await previewInvite(signedOut(), newInviteToken()),
      await previewInvite(signedOut(), "ZZZZZZZZ"),
      await previewInvite(signedOut(), oldToken),
      await previewInvite(signedOut(), oldCode),
      await previewInvite({ ...signedOut(), groups: gone }, stored.inviteToken),
    ];
    for (const result of results) expect(result).toEqual({ state: "invalid" });
  });

  it("previewInvite resolves an 8-character key as a code and anything else as a token, case-insensitively for codes", async () => {
    const { as, groups, signedOut } = setup();
    const { group } = await make(as(person("Asha")));
    const stored = (await groups.findById(group.id))!;

    const code = `${stored.inviteCode.slice(0, 4)}-${stored.inviteCode.slice(4)}`.toLowerCase();
    expect(await previewInvite(signedOut(), code)).toMatchObject({ state: "open", groupId: group.id });
    expect(await previewInvite(signedOut(), stored.inviteToken)).toMatchObject({ state: "open", groupId: group.id });
    // A token is case-sensitive: changing its case finds nothing.
    expect(await previewInvite(signedOut(), stored.inviteToken.toLowerCase())).toEqual({ state: "invalid" });

    const spy = vi.spyOn(groups, "findByInvite");
    await previewInvite(signedOut(), stored.inviteCode.toLowerCase());
    await previewInvite(signedOut(), stored.inviteToken);
    expect(spy.mock.calls).toEqual([[{ code: stored.inviteCode }], [{ token: stored.inviteToken }]]);
  });

  it("previewInvite shows the group to a signed-out person, with the owner's name", async () => {
    const authStore = createFakeAuthStore();
    const { as } = setup(createFakeGroupStore(authStore));
    const owner = as(person("Asha Rao"));
    authStore.users.set(owner.user.id, {
      id: owner.user.id,
      email: "asha@example.test",
      password: null,
      displayName: "Asha Rao",
      termsVersion: null,
      confirmed: true,
      identities: [],
    });
    const { group } = await make(owner, passwordGroup);
    const preview = await previewInvite({ ...owner, user: null }, group.inviteCode);
    expect(preview).toEqual({
      state: "open",
      groupId: group.id,
      name: "Chemistry 101",
      joinMode: "password",
      ownerName: "Asha Rao",
    });
  });

  it("previewInvite says member for a member and removed for a removed person", async () => {
    const { as, groups } = setup();
    const { group } = await make(as(person("Asha")));
    const bob = as(person("Bob"));
    const carol = as(person("Carol"));
    await joinGroup(bob, { key: group.inviteCode });
    await joinGroup(carol, { key: group.inviteCode });
    await groups.removeMember(group.id, carol.user.id);

    expect(await previewInvite(bob, group.inviteCode)).toEqual({ state: "member", groupId: group.id });
    expect(await previewInvite(carol, group.inviteCode)).toEqual({ state: "removed" });
  });

  it("previewInvite limits lookups per person and per network, answering limited when over", async () => {
    const { as, signedOut } = setup();
    const bob = as(person("Bob"), "10.0.0.5");
    for (let i = 0; i < 60; i++) await previewInvite(bob, newInviteToken());
    const { group } = await make(as(person("Asha"), "10.0.0.9"));
    expect(await previewInvite(bob, group.inviteCode)).toEqual({ state: "limited", retryAfterSeconds: expect.any(Number) });
    const limited = await previewInvite(bob, group.inviteCode);
    expect(limited.state === "limited" && limited.retryAfterSeconds).toBeGreaterThan(0);
    // Another person on another address is unaffected, and signed-out lookups still count per address.
    expect(await previewInvite(signedOut("10.0.0.7"), group.inviteCode)).toMatchObject({ state: "open" });
    for (let i = 0; i < 300; i++) await previewInvite(signedOut("10.0.0.8"), newInviteToken());
    expect(await previewInvite(signedOut("10.0.0.8"), group.inviteCode)).toEqual({ state: "limited", retryAfterSeconds: expect.any(Number) });
    // A signed-in person on the busy address is held by the address limit too.
    expect(await previewInvite(as(person("Dan"), "10.0.0.8"), group.inviteCode)).toMatchObject({ state: "limited" });
  });
});

describe("joinGroup", () => {
  it("joinGroup in link mode joins at once", async () => {
    const { as } = setup();
    const { group } = await make(as(person("Asha")));
    const bob = as(person("Bob"));
    const url = group.inviteUrl.split("/invite/")[1];
    expect(await joinGroup(bob, { key: url })).toEqual({ ok: true, data: { groupId: group.id } });
    expect(await listMyGroups(bob)).toEqual([{ id: group.id, name: "Maths club" }]);
  });

  it("joinGroup in password mode refuses a wrong password and joins with the right one", async () => {
    const { as } = setup();
    const { group } = await make(as(person("Asha")), passwordGroup);
    const bob = as(person("Bob"));
    expect(await joinGroup(bob, { key: group.inviteCode, password: "nope nope" })).toEqual({
      ok: false,
      fieldErrors: { password: GROUP_MESSAGES.wrongPassword },
    });
    expect(await joinGroup(bob, { key: group.inviteCode })).toMatchObject({ ok: false });
    expect(await listMyGroups(bob)).toEqual([]);
    expect(await joinGroup(bob, { key: group.inviteCode, password: PASSWORD })).toEqual({ ok: true, data: { groupId: group.id } });
  });

  it("joinGroup refuses a key that matches nothing and a bad form", async () => {
    const { as } = setup();
    const bob = as(person("Bob"));
    expect(await joinGroup(bob, { key: "ABCDEFGH" })).toEqual({ ok: false, formError: GROUP_MESSAGES.invalidInvite });
    expect(await joinGroup(bob, {})).toMatchObject({ ok: false });
  });

  it("five wrong passwords lock the person out, and the right password is refused with the locked message while locked", async () => {
    const { as, advance } = setup();
    const { group } = await make(as(person("Asha")), passwordGroup);
    const bob = as(person("Bob"));
    for (let i = 0; i < 5; i++) {
      expect(await joinGroup(bob, { key: group.inviteCode, password: `wrong ${i}!` })).toMatchObject({
        ok: false,
        fieldErrors: { password: GROUP_MESSAGES.wrongPassword },
      });
    }
    vi.mocked(verifyGroupPassword).mockClear();
    const locked = await joinGroup(bob, { key: group.inviteCode, password: PASSWORD });
    expect(vi.mocked(verifyGroupPassword)).not.toHaveBeenCalled();
    expect(locked).toMatchObject({ ok: false, formError: GROUP_MESSAGES.locked });
    expect(locked.ok === false && locked.retryAfterSeconds).toBeGreaterThan(0);
    expect(await listMyGroups(bob)).toEqual([]);

    // A refused attempt during the lockout does not extend it: after the window the right password works.
    advance(15 * 60 + 1);
    expect(await joinGroup(bob, { key: group.inviteCode, password: PASSWORD })).toMatchObject({ ok: true });
  });

  it("the fifth try can still join with the right password, after four wrong ones", async () => {
    const { as } = setup();
    const { group } = await make(as(person("Asha")), passwordGroup);
    const bob = as(person("Bob"));
    for (let i = 0; i < 4; i++) await joinGroup(bob, { key: group.inviteCode, password: `wrong ${i}!` });
    expect(await joinGroup(bob, { key: group.inviteCode, password: PASSWORD })).toEqual({ ok: true, data: { groupId: group.id } });
  });

  it("parallel wrong guesses cannot get past the limit, and locked ones do not run scrypt", async () => {
    const { as } = setup();
    const { group } = await make(as(person("Asha")), passwordGroup);
    const bob = as(person("Bob"));
    vi.mocked(verifyGroupPassword).mockClear();

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => joinGroup(bob, { key: group.inviteCode, password: `wrong ${i}!` })),
    );
    const wrong = results.filter((r) => !r.ok && r.fieldErrors?.password === GROUP_MESSAGES.wrongPassword);
    const locked = results.filter((r) => !r.ok && r.formError === GROUP_MESSAGES.locked);
    expect(wrong.length).toBeLessThanOrEqual(5);
    expect(wrong.length + locked.length).toBe(10);
    expect(vi.mocked(verifyGroupPassword)).toHaveBeenCalledTimes(wrong.length);
  });

  it("a lockout is per person and per group (another person, another group are unaffected)", async () => {
    const { as } = setup();
    const owner = as(person("Asha"));
    const { group } = await make(owner, passwordGroup);
    const other = await make(owner, { ...passwordGroup, name: "Physics 101" });
    const bob = as(person("Bob"));
    const carol = as(person("Carol"));
    for (let i = 0; i < 5; i++) await joinGroup(bob, { key: group.inviteCode, password: `wrong ${i}!` });
    expect(await joinGroup(bob, { key: group.inviteCode, password: PASSWORD })).toMatchObject({ formError: GROUP_MESSAGES.locked });

    expect(await joinGroup(carol, { key: group.inviteCode, password: PASSWORD })).toMatchObject({ ok: true });
    expect(await joinGroup(bob, { key: other.group.inviteCode, password: PASSWORD })).toMatchObject({ ok: true });
  });

  it("a link-only group never touches the wrong-password key", async () => {
    const { as, limiter } = setup();
    const { group } = await make(as(person("Asha")));
    const bob = as(person("Bob"));
    const peek = vi.spyOn(limiter, "peek");
    const hit = vi.spyOn(limiter, "hit");
    await joinGroup(bob, { key: group.inviteCode, password: "whatever you like" });
    const keys = [...peek.mock.calls, ...hit.mock.calls].map(([input]) => input.key);
    expect(keys.some((key) => key.startsWith("join-wrong:"))).toBe(false);
  });

  it("joinGroup refuses a removed person with cannotJoin on token and on code paths", async () => {
    const { as, groups } = setup();
    const { group } = await make(as(person("Asha")), passwordGroup);
    const bob = as(person("Bob"));
    await joinGroup(bob, { key: group.inviteCode, password: PASSWORD });
    await groups.removeMember(group.id, bob.user.id);

    const token = group.inviteUrl.split("/invite/")[1];
    const expected = { ok: false, formError: GROUP_MESSAGES.cannotJoin };
    expect(await joinGroup(bob, { key: token, password: PASSWORD })).toEqual(expected);
    expect(await joinGroup(bob, { key: group.inviteCode, password: PASSWORD })).toEqual(expected);
    expect(await joinGroup(bob, { key: group.inviteCode, password: "wrong wrong" })).toEqual(expected);
  });

  it("joinGroup on a full group gives full", async () => {
    const { as, groups } = setup();
    const { group } = await make(as(person("Asha")));
    for (let i = 1; i < GROUP_LIMITS.maxMembers; i++) expect(await groups.addMember(group.id, crypto.randomUUID())).toBe("joined");
    expect(await joinGroup(as(person("Bob")), { key: group.inviteCode })).toEqual({ ok: false, formError: GROUP_MESSAGES.full });
  });

  it("joinGroup twice (double tap) leaves one membership and the second says success", async () => {
    const { as, groups } = setup();
    const { group } = await make(as(person("Asha")));
    const bob = as(person("Bob"));
    const [first, second] = await Promise.all([
      joinGroup(bob, { key: group.inviteCode }),
      joinGroup(bob, { key: group.inviteCode }),
    ]);
    expect(first).toEqual({ ok: true, data: { groupId: group.id } });
    expect(second).toEqual({ ok: true, data: { groupId: group.id } });
    expect((await groups.listMembers(group.id)).filter((m) => m.userId === bob.user.id)).toHaveLength(1);
  });

  it("joinGroup for someone already in 20 groups gives tooManyGroups", async () => {
    const { as, groups } = setup();
    const { group } = await make(as(person("Asha")));
    const bob = as(person("Bob"));
    for (let i = 0; i < GROUP_LIMITS.maxGroupsPerPerson; i++) await seedGroup(groups, bob.user.id, `Group ${i}`);
    expect(await joinGroup(bob, { key: group.inviteCode })).toEqual({ ok: false, formError: GROUP_MESSAGES.tooManyGroups });
  });

  it("joinGroup for a member returns the group id without asking the password", async () => {
    const { as, limiter } = setup();
    const { group } = await make(as(person("Asha")), passwordGroup);
    const bob = as(person("Bob"));
    await joinGroup(bob, { key: group.inviteCode, password: PASSWORD });
    for (let i = 0; i < 5; i++) await limiter.hit({ key: `join-wrong:${group.id}:${bob.user.id}`, limit: 5, windowSeconds: 900 });

    // Even locked, with no password or a wrong one: already in means success.
    expect(await joinGroup(bob, { key: group.inviteCode })).toEqual({ ok: true, data: { groupId: group.id } });
    expect(await joinGroup(bob, { key: group.inviteCode, password: "wrong wrong" })).toEqual({ ok: true, data: { groupId: group.id } });
  });

  it("joinGroup limits lookups per network", async () => {
    const { as } = setup();
    const { group } = await make(as(person("Asha"), "10.0.0.9"));
    for (let i = 0; i < 300; i++) await joinGroup(as(person("Guesser"), "10.0.0.2"), { key: newInviteToken() });
    const result = await joinGroup(as(person("Bob"), "10.0.0.2"), { key: group.inviteCode });
    expect(result).toMatchObject({ ok: false, formError: GROUP_MESSAGES.tooMany });
  });
});

describe("viewGroup, listGroupMembers and leaveGroup", () => {
  it("viewGroup returns null for a non-member, a removed member, a malformed id and an unknown id", async () => {
    const { as, groups } = setup();
    const owner = as(person("Asha"));
    const { group } = await make(owner, passwordGroup);
    const bob = as(person("Bob"));
    await joinGroup(bob, { key: group.inviteCode, password: PASSWORD });

    const owned = await viewGroup(owner, group.id);
    expect(owned?.membership).toEqual({ role: "owner", status: "active" });
    expect(owned?.group.name).toBe("Chemistry 101");
    expect(JSON.stringify(owned)).not.toContain("scrypt");
    expect(await viewGroup(bob, group.id)).toMatchObject({ membership: { role: "member", status: "active" } });

    expect(await viewGroup(as(person("Stranger")), group.id)).toBeNull();
    await groups.removeMember(group.id, bob.user.id);
    expect(await viewGroup(bob, group.id)).toBeNull();
    expect(await viewGroup(owner, "not-a-uuid")).toBeNull();
    expect(await viewGroup(owner, "' or 1=1 --")).toBeNull();
    expect(await viewGroup(owner, crypto.randomUUID())).toBeNull();
  });

  it("viewGroup shows the invite to the owner only, and a member's result holds neither the token nor the code", async () => {
    const { as, groups } = setup();
    const owner = as(person("Asha"));
    const { group } = await make(owner);
    const stored = (await groups.findById(group.id))!;
    const bob = as(person("Bob"));
    await joinGroup(bob, { key: group.inviteCode });

    const asOwner = await viewGroup(owner, group.id);
    expect(asOwner?.group.invite).toEqual({ url: `${SITE}/invite/${stored.inviteToken}`, code: stored.inviteCode });

    const asMember = await viewGroup(bob, group.id);
    expect(asMember).not.toBeNull();
    expect(asMember?.group.invite).toBeUndefined();
    const text = JSON.stringify(asMember);
    expect(text).not.toContain(stored.inviteToken);
    expect(text).not.toContain(stored.inviteCode);
  });

  it("listGroupMembers returns null for a non-member", async () => {
    const { as, groups } = setup();
    const owner = as(person("Asha"));
    const { group } = await make(owner);
    const bob = as(person("Bob"));
    await joinGroup(bob, { key: group.inviteCode });

    expect((await listGroupMembers(owner, group.id))?.map((m) => m.userId)).toEqual([owner.user.id, bob.user.id]);
    expect(await listGroupMembers(bob, group.id)).toHaveLength(2);
    expect(await listGroupMembers(as(person("Stranger")), group.id)).toBeNull();
    expect(await listGroupMembers(owner, "not-a-uuid")).toBeNull();
    expect(await listGroupMembers(owner, crypto.randomUUID())).toBeNull();
    await groups.removeMember(group.id, bob.user.id);
    expect(await listGroupMembers(bob, group.id)).toBeNull();
  });

  it("leaveGroup works for a member, refuses the owner with ownerCannotLeave, and lets the person rejoin", async () => {
    const { as } = setup();
    const owner = as(person("Asha"));
    const { group } = await make(owner);
    const bob = as(person("Bob"));
    await joinGroup(bob, { key: group.inviteCode });

    expect(await leaveGroup(bob, group.id)).toEqual({ ok: true, data: undefined });
    expect(await listMyGroups(bob)).toEqual([]);
    expect(await leaveGroup(bob, group.id)).toEqual({ ok: true, data: undefined }); // a double tap
    expect(await leaveGroup(owner, group.id)).toEqual({ ok: false, formError: GROUP_MESSAGES.ownerCannotLeave });
    expect(await listMyGroups(owner)).toHaveLength(1);
    expect(await joinGroup(bob, { key: group.inviteCode })).toMatchObject({ ok: true });
    expect(await leaveGroup(bob, "not-a-uuid")).toEqual({ ok: true, data: undefined });
  });

  it("leaveGroup does not clear a removal", async () => {
    const { as, groups } = setup();
    const { group } = await make(as(person("Asha")));
    const bob = as(person("Bob"));
    await joinGroup(bob, { key: group.inviteCode });
    await groups.removeMember(group.id, bob.user.id);
    await leaveGroup(bob, group.id);
    expect(await joinGroup(bob, { key: group.inviteCode })).toEqual({ ok: false, formError: GROUP_MESSAGES.cannotJoin });
  });
});

describe("secrets stay secret", () => {
  const spies = ["log", "info", "warn", "error", "debug"] as const;
  let logged: unknown[][];

  beforeEach(() => {
    logged = [];
    for (const method of spies) vi.spyOn(console, method).mockImplementation((...args) => void logged.push(args));
  });
  afterEach(() => vi.restoreAllMocks());

  it("no result, message or log line contains the password or its hash", async () => {
    const { as, groups } = setup();
    const owner = as(person("Asha"));
    const secret = "tangerine-secret-42";
    const created = await make(owner, { ...passwordGroup, password: secret });
    const hash = (await groups.findById(created.group.id))!.passwordHash!;
    const bob = as(person("Bob"));

    const outputs: unknown[] = [];
    // The one place the plaintext is returned is createGroup's `password`; everything else must not carry it.
    outputs.push(created.group);
    outputs.push(await previewInvite(bob, created.group.inviteCode));
    for (let i = 0; i < 6; i++) outputs.push(await joinGroup(bob, { key: created.group.inviteCode, password: `${secret}-x${i}` }));
    outputs.push(await joinGroup(bob, { key: created.group.inviteCode, password: secret }));
    outputs.push(await viewGroup(owner, created.group.id));
    outputs.push(await listGroupMembers(owner, created.group.id));
    outputs.push(await listMyGroups(owner));
    outputs.push(await leaveGroup(owner, created.group.id));

    // A limiter that throws makes the use-case log its warning; that line must be clean too.
    const broken = { ...as(person("Dan")), limiter: { hit: async () => Promise.reject(new Error(`boom ${secret}`)), peek: async () => Promise.reject(new Error("boom")) } };
    outputs.push(await joinGroup(broken, { key: created.group.inviteCode, password: `${secret}-y` }));

    // A store whose createGroup fails with an error that carries the hash and the password (as a
    // database driver printing its query values would).
    const leaky: GroupStore = {
      ...groups,
      createGroup: async (input) => {
        throw new Error(`insert failed: params ${input.passwordHash}, ${secret}`);
      },
    };
    const failed = await createGroup({ ...as(person("Eve")), groups: leaky }, { ...passwordGroup, password: secret });
    expect(failed).toEqual({ ok: false, formError: GROUP_MESSAGES.couldNotSave });
    outputs.push(failed);

    for (const text of [JSON.stringify(outputs), JSON.stringify(logged)]) {
      expect(text).not.toContain(secret);
      expect(text).not.toContain(hash);
      expect(text).not.toContain("scrypt$");
    }
    expect(logged.length).toBeGreaterThan(0);
  });
});
