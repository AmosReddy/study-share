import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeAuthStore } from "@/server/adapters/fake-auth-provider";
import { createFakeFileStorage, resetFakeFileStorage } from "@/server/adapters/fake-file-storage";
import { createFakeGroupStore, resetFakeGroupStore, setFakeGroupFormConfig } from "@/server/adapters/fake-group-store";
import { createFakeResourceStore, resetFakeResourceStore } from "@/server/adapters/fake-resource-store";
import { createMemoryRateLimiter } from "@/server/adapters/memory-rate-limiter";
import { newGroupCode, newInviteToken } from "@/server/groups/secrets";
import type { GroupStore } from "@/server/ports/group-store";
import { DEFAULT_FORM_CONFIG, FORM_MESSAGES, type DraftFormConfig, type FormConfig } from "@/shared/form-config";
import { getFile, listFiles, prepareUpload, type FileDeps } from "./use-cases";
import { getFormEditorState, saveFormConfig } from "./form-use-cases";

const SITE = "https://app.test";
type Person = { id: string; displayName: string };

function setup(overrides: { groups?: (real: GroupStore) => GroupStore } = {}) {
  resetFakeGroupStore();
  resetFakeResourceStore();
  resetFakeFileStorage();
  const auth = createFakeAuthStore();
  const real = createFakeGroupStore(auth);
  const groups = overrides.groups ? overrides.groups(real) : real;
  const resources = createFakeResourceStore(auth);
  const limiter = createMemoryRateLimiter(() => Date.now());

  const person = (displayName: string): Person => {
    const id = crypto.randomUUID();
    auth.users.set(id, { id, email: `${id}@example.test`, password: null, displayName, termsVersion: null, confirmed: true, identities: [] });
    return { id, displayName };
  };
  const as = (user: Person) => ({ groups, limiter, siteUrl: SITE, ip: "10.0.0.1", user });
  const storage = createFakeFileStorage({ siteUrl: SITE, now: () => Date.now() });
  const asFiles = (user: Person): FileDeps => ({ ...as(user), resources, storage });
  const makeGroup = async (owner: Person) => {
    const result = await real.createGroup({
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
  const config = async (groupId: string) => (await real.findById(groupId))!.formConfig;
  return { real, groups, resources, person, as, asFiles, makeGroup, config };
}

/** The default form, with its active items as the editor would send them. */
const defaultDraft = (): DraftFormConfig => ({
  version: 1,
  types: DEFAULT_FORM_CONFIG.types.map((t) => ({ id: t.id, label: t.label })),
  fields: DEFAULT_FORM_CONFIG.fields.map((f) => ({ id: f.id, label: f.label, kind: f.kind, required: f.required })),
});

const semesterDraft = (): DraftFormConfig => ({
  version: 1,
  types: [{ id: "notes", label: "Notes" }, { id: "", label: "Slides" }],
  fields: [
    { id: "", label: "Semester", kind: "dropdown", required: true, options: [{ id: "", label: "Sem 1" }, { id: "", label: "Sem 2" }] },
    { id: "subject", label: "Subject", kind: "text", required: false },
  ],
});

let ids = 0;
const newId = () => `id${++ids}`;

beforeEach(() => {
  ids = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("saveFormConfig: the owner saves", () => {
  it("replaces the group's form, bumps the version and gives new items ids from the server", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);

    const result = await saveFormConfig(t.as(owner), groupId, semesterDraft(), newId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.version).toBe(2);
    expect(result.config.types.find((t) => t.label === "Slides")?.id).toBe("id1");
    // The dropped default types are archived, not deleted.
    expect(result.config.types.filter((type) => type.archived).map((type) => type.id)).toEqual(["pyq", "study_material", "assignment"]);
    expect(await t.config(groupId)).toEqual(result.config);
  });

  it("works with the default id generator (ids are short and distinct)", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    const result = await saveFormConfig(t.as(owner), groupId, semesterDraft());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const all = [...result.config.types, ...result.config.fields, ...result.config.fields.flatMap((f) => f.options ?? [])].map((x) => x.id);
    expect(all.every((id) => id.length > 0 && id.length <= 64)).toBe(true);
  });

  it("the next save needs the new version", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    expect((await saveFormConfig(t.as(owner), groupId, semesterDraft(), newId)).ok).toBe(true);
    const again = await saveFormConfig(t.as(owner), groupId, semesterDraft(), newId);
    expect(again).toEqual({ ok: false, errors: {}, formError: FORM_MESSAGES.formChangedElsewhere });
    expect((await t.config(groupId)).version).toBe(2);
  });

  it("returns the field-level errors of a bad draft and saves nothing", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    const draft = defaultDraft();
    draft.types.push({ id: "", label: "notes" }, { id: "", label: "" });
    const result = await saveFormConfig(t.as(owner), groupId, draft, newId);
    expect(result).toEqual({
      ok: false,
      errors: { "type:4": FORM_MESSAGES.labelTaken, "type:5": FORM_MESSAGES.labelRequired, types: FORM_MESSAGES.tooManyTypes(5) },
    });
    expect(await t.config(groupId)).toEqual(DEFAULT_FORM_CONFIG);
  });

  it("two saves from the same version, at the same instant: one wins, the other is told the form changed", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    const one: DraftFormConfig = { ...defaultDraft(), types: [{ id: "", label: "One" }] };
    const two: DraftFormConfig = { ...defaultDraft(), types: [{ id: "", label: "Two" }] };
    const results = await Promise.all([
      saveFormConfig(t.as(owner), groupId, one, newId),
      saveFormConfig(t.as(owner), groupId, two, newId),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, errors: {}, formError: FORM_MESSAGES.formChangedElsewhere }]);
    expect((await t.config(groupId)).version).toBe(2);
  });

  it("a stale draft is refused by the store too, when the group changed after the use-case read it", async () => {
    // The group is read at version 1; before the write lands, another save makes it version 2.
    let racer: (() => Promise<unknown>) | null = null;
    const t = setup({
      groups: (real) => ({
        ...real,
        updateFormConfig: async (...args) => {
          if (racer) {
            const run = racer;
            racer = null;
            await run();
          }
          return real.updateFormConfig(...args);
        },
      }),
    });
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    racer = async () => {
      await t.real.updateFormConfig(groupId, 1, { ...DEFAULT_FORM_CONFIG, version: 2 });
    };
    const result = await saveFormConfig(t.as(owner), groupId, semesterDraft(), newId);
    expect(result).toEqual({ ok: false, errors: {}, formError: FORM_MESSAGES.formChangedElsewhere });
    expect(await t.config(groupId)).toEqual({ ...DEFAULT_FORM_CONFIG, version: 2 });
  });

  it("a group deleted while saving looks like any missing group", async () => {
    const t = setup({
      groups: (real) => ({ ...real, updateFormConfig: async () => "group_gone" as const }),
    });
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    const result = await saveFormConfig(t.as(owner), groupId, semesterDraft(), newId);
    expect(result).toEqual({ ok: false, notFound: true, errors: {}, formError: FORM_MESSAGES.notAvailable });
  });
});

describe("saveFormConfig: who may save", () => {
  it("answers a member, a removed member, a stranger, an unknown or deleted group, a malformed id and another group's id exactly alike", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const member = t.person("Ravi");
    const removed = t.person("Gone");
    const stranger = t.person("Mina");
    const groupId = await t.makeGroup(owner);
    await t.real.addMember(groupId, member.id);
    await t.real.addMember(groupId, removed.id);
    await t.real.removeMember(groupId, removed.id);
    const otherOwner = t.person("Other owner");
    const otherGroup = await t.makeGroup(otherOwner);
    const deletedGroup = await t.makeGroup(t.person("Del"));
    await t.real.softDeleteGroup(deletedGroup);

    const expected = { ok: false, notFound: true, errors: {}, formError: FORM_MESSAGES.notAvailable };
    const attempts: [string, Person][] = [
      [groupId, member],
      [groupId, removed],
      [groupId, stranger],
      [crypto.randomUUID(), owner],
      ["not-a-uuid", owner],
      ["", owner],
      [deletedGroup, owner],
      [otherGroup, owner], // owner of ANOTHER group
      [groupId, otherOwner], // and that owner asking for this group
    ];
    // A valid draft, a draft that would be refused, and rubbish: the answer never depends on them.
    for (const draft of [semesterDraft(), { ...defaultDraft(), types: "x" }, null, "x", 5, { version: "1" }]) {
      for (const [id, who] of attempts) {
        expect(await saveFormConfig(t.as(who), id, draft, newId), `${who.displayName} ${id}`).toEqual(expected);
      }
    }
    expect(await t.config(groupId)).toEqual(DEFAULT_FORM_CONFIG);
    expect(await t.config(otherGroup)).toEqual(DEFAULT_FORM_CONFIG);
  });

  it("a former owner who handed the group over can no longer save", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const next = t.person("Ravi");
    const groupId = await t.makeGroup(owner);
    await t.real.addMember(groupId, next.id);
    await t.real.transferOwnership(groupId, owner.id, next.id);
    expect((await saveFormConfig(t.as(owner), groupId, semesterDraft(), newId)).ok).toBe(false);
    expect((await saveFormConfig(t.as(next), groupId, semesterDraft(), newId)).ok).toBe(true);
  });

  it("a failure of the store while checking is logged as a fixed line and answers could-not-save, never not-found", async () => {
    const t = setup({
      groups: (real) => ({
        ...real,
        findById: async () => {
          throw new Error("password=hunter2 host=db.internal");
        },
      }),
    });
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    const result = await saveFormConfig(t.as(owner), groupId, semesterDraft(), newId);
    expect(result).toEqual({ ok: false, errors: {}, formError: FORM_MESSAGES.couldNotSave });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toMatch(/hunter2|db\.internal|[0-9a-f]{8}-[0-9a-f]{4}/);
  });

  it("a failure of the write is logged as a fixed line and answers could-not-save, and nothing is saved", async () => {
    const t = setup({
      groups: (real) => ({
        ...real,
        updateFormConfig: async () => {
          throw new Error("connection to 10.1.2.3 refused");
        },
      }),
    });
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    const result = await saveFormConfig(t.as(owner), groupId, semesterDraft(), newId);
    expect(result).toEqual({ ok: false, errors: {}, formError: FORM_MESSAGES.couldNotSave });
    expect(console.error).toHaveBeenCalledWith("Could not save the upload form.");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toMatch(/10\.1\.2\.3|refused/);
    expect(await t.config(groupId)).toEqual(DEFAULT_FORM_CONFIG);
  });
});

describe("saveFormConfig: a hostile draft", () => {
  const rejected = { ok: false, errors: {} } as const;

  async function trySave(raw: unknown) {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    const result = await saveFormConfig(t.as(owner), groupId, raw, newId);
    expect(await t.config(groupId), "nothing is saved").toEqual(DEFAULT_FORM_CONFIG);
    return result;
  }

  it("a shape that is not a draft gets a friendly message, never an error", async () => {
    const shapes: unknown[] = [
      undefined,
      null,
      5,
      "text",
      true,
      [],
      {},
      { version: 1 },
      { version: "1", types: [], fields: [] },
      { version: 1.5, types: [], fields: [] },
      { version: 0, types: [], fields: [] },
      { version: 1, types: {}, fields: [] },
      { version: 1, types: [], fields: "x" },
      { version: 1, types: [null], fields: [] },
      { version: 1, types: [{ id: 5, label: "x" }], fields: [] },
      { version: 1, types: [{ id: "", label: null }], fields: [] },
      { version: 1, types: [], fields: [{ id: "", label: "x", kind: "number", required: false }] },
      { version: 1, types: [], fields: [{ id: "", label: "x", kind: "text", required: "yes" }] },
      { version: 1, types: [], fields: [{ id: "", label: "x", kind: "dropdown", required: false, options: "abc" }] },
      { version: 1, types: [], fields: [{ id: "", label: "x", kind: "dropdown", required: false, options: [5] }] },
    ];
    for (const raw of shapes) {
      const result = await trySave(raw);
      expect(result, JSON.stringify(raw)).toMatchObject(rejected);
      expect(result.ok === false && result.formError, JSON.stringify(raw)).toBe(FORM_MESSAGES.badDraft);
    }
  });

  it("a draft with far too many items is refused as too big, with a size limit that still allows the largest real form", async () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ id: "", label: `T${i}` }));
    for (const raw of [
      { version: 1, types: many(500), fields: [] },
      { version: 1, types: many(61), fields: [] },
      { version: 1, types: [], fields: Array.from({ length: 500 }, (_, i) => ({ id: "", label: `F${i}`, kind: "text", required: false })) },
      { version: 1, types: [], fields: [{ id: "", label: "F", kind: "dropdown", required: false, options: many(500) }] },
      { version: 1, types: many(30), fields: [{ id: "", label: "F", kind: "dropdown", required: false, options: many(31) }] },
    ]) {
      const result = await trySave(raw);
      expect(result).toEqual({ ok: false, errors: {}, formError: FORM_MESSAGES.formTooBig });
    }

    // 5 types, 3 dropdowns of 15 choices: the biggest allowed form is 53 items, and it saves.
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    const largest: DraftFormConfig = {
      version: 1,
      types: many(5),
      fields: [0, 1, 2].map((f) => ({ id: "", label: `D${f}`, kind: "dropdown" as const, required: false, options: many(15) })),
    };
    expect((await saveFormConfig(t.as(owner), groupId, largest)).ok).toBe(true);
  });

  it("a huge label is cut before it is looked at and refused for its length, with a field-level message", async () => {
    const result = await trySave({ ...defaultDraft(), types: [{ id: "", label: "x".repeat(5_000_000) }] });
    expect(result).toEqual({ ok: false, errors: { "type:0": FORM_MESSAGES.tooLong(40) } });
    const longId = await trySave({ ...defaultDraft(), types: [{ id: "n".repeat(5_000_000), label: "ok" }] });
    expect(longId).toEqual({ ok: false, errors: { "type:0": FORM_MESSAGES.itemUnknown } });
  });

  it("odd ids and keys: __proto__, other, constructor, an id of another kind of item", async () => {
    for (const id of ["__proto__", "other", "constructor", "year", "s0"]) {
      const result = await trySave({ ...defaultDraft(), types: [{ id, label: "Anything" }] });
      expect(result, id).toEqual({ ok: false, errors: { "type:0": FORM_MESSAGES.itemUnknown } });
    }
    const polluted = JSON.parse('{"version":1,"types":[{"id":"","label":"A","__proto__":{"x":1}}],"fields":[],"__proto__":{"admin":true}}');
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    const result = await saveFormConfig(t.as(owner), groupId, polluted, newId);
    expect(result.ok).toBe(true);
    expect(({} as Record<string, unknown>).admin).toBeUndefined();
    expect(JSON.stringify((await t.config(groupId)).types)).not.toContain("admin");
  });

  it("a changed kind, 6 types, 4 details and a dropdown with 1 or 16 choices come back as the editor's own messages", async () => {
    const six = await trySave({ ...defaultDraft(), types: Array.from({ length: 6 }, (_, i) => ({ id: "", label: `T${i}` })) });
    expect(six).toEqual({ ok: false, errors: { types: FORM_MESSAGES.tooManyTypes(5) } });
    const four = await trySave({ ...defaultDraft(), fields: Array.from({ length: 4 }, (_, i) => ({ id: "", label: `F${i}`, kind: "text", required: false })) });
    expect(four).toEqual({ ok: false, errors: { fields: FORM_MESSAGES.tooManyDetails(3) } });
    const kind = await trySave({ ...defaultDraft(), fields: [{ id: "subject", label: "Subject", kind: "dropdown", required: false, options: [{ id: "", label: "A" }, { id: "", label: "B" }] }] });
    expect(kind).toEqual({ ok: false, errors: { "field:0:label": FORM_MESSAGES.kindLocked } });
    const one = await trySave({ ...defaultDraft(), fields: [{ id: "", label: "F", kind: "dropdown", required: false, options: [{ id: "", label: "A" }] }] });
    expect(one).toEqual({ ok: false, errors: { "field:0:options": FORM_MESSAGES.tooFewChoices(2) } });
    const sixteen = await trySave({ ...defaultDraft(), fields: [{ id: "", label: "F", kind: "dropdown", required: false, options: Array.from({ length: 16 }, (_, i) => ({ id: "", label: `C${i}` })) }] });
    expect(sixteen).toEqual({ ok: false, errors: { "field:0:options": FORM_MESSAGES.tooManyChoices(15) } });
  });
});

describe("saveFormConfig: old files keep what they point at", () => {
  it("a file of a type the owner drops keeps showing it as removed; a renamed type updates", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    const prepared = await prepareUpload(t.asFiles(owner), groupId, {
      title: "Old paper",
      typeId: "pyq",
      typeOther: "",
      details: { subject: "Maths" },
      fileName: "p.pdf",
      contentType: "application/pdf",
      sizeBytes: 100,
    });
    if (!prepared.ok) throw new Error(JSON.stringify(prepared));
    const row = await t.resources.markReady(prepared.data.resourceId, groupId);
    if (!row) throw new Error("not ready");

    const draft = defaultDraft();
    draft.types = [{ id: "notes", label: "Class notes" }]; // pyq, study_material, assignment dropped
    expect((await saveFormConfig(t.as(owner), groupId, draft, newId)).ok).toBe(true);

    const file = await getFile(t.asFiles(owner), groupId, row.id);
    expect(file).toMatchObject({ typeId: "pyq", typeLabel: "Previous year paper", typeRemoved: true });
    const library = await listFiles(t.asFiles(owner), groupId);
    expect(library?.filters.types.map((type) => [type.id, type.label, type.removed])).toEqual([
      ["notes", "Class notes", false],
      ["pyq", "Previous year paper", true],
      ["other", "Other", false],
    ]);
  });
});

describe("getFormEditorState", () => {
  it("lets the owner edit and lets a member read", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const member = t.person("Ravi");
    const groupId = await t.makeGroup(owner);
    await t.real.addMember(groupId, member.id);
    expect(await getFormEditorState(t.as(owner), groupId)).toEqual({ formConfig: DEFAULT_FORM_CONFIG, canEdit: true });
    expect(await getFormEditorState(t.as(member), groupId)).toEqual({ formConfig: DEFAULT_FORM_CONFIG, canEdit: false });
  });

  it("shows the group's own form", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    const custom: FormConfig = { version: 4, types: [{ id: "a1", label: "Lecture" }], fields: [] };
    setFakeGroupFormConfig(groupId, custom);
    expect((await getFormEditorState(t.as(owner), groupId))?.formConfig).toEqual(custom);
  });

  it("answers null to a removed member, a stranger, an unknown or deleted group and a malformed id", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const removed = t.person("Gone");
    const stranger = t.person("Mina");
    const groupId = await t.makeGroup(owner);
    await t.real.addMember(groupId, removed.id);
    await t.real.removeMember(groupId, removed.id);
    const deleted = await t.makeGroup(t.person("Del"));
    await t.real.softDeleteGroup(deleted);
    for (const [id, who] of [
      [groupId, removed],
      [groupId, stranger],
      [crypto.randomUUID(), owner],
      ["not-a-uuid", owner],
      [deleted, owner],
    ] as [string, Person][]) {
      expect(await getFormEditorState(t.as(who), id), `${who.displayName} ${id}`).toBeNull();
    }
  });

  it("a store failure throws (the page's error screen), never null", async () => {
    const t = setup({
      groups: (real) => ({
        ...real,
        findById: async () => {
          throw new Error("down");
        },
      }),
    });
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    await expect(getFormEditorState(t.as(owner), groupId)).rejects.toThrow("down");
  });
});
