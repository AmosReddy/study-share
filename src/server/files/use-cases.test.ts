import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkFakeUpload,
  createFakeFileStorage,
  getFakeFileStorageState,
  readFakeDownload,
  resetFakeFileStorage,
} from "@/server/adapters/fake-file-storage";
import { createFakeAuthStore } from "@/server/adapters/fake-auth-provider";
import { createFakeGroupStore, resetFakeGroupStore, setFakeGroupFormConfig } from "@/server/adapters/fake-group-store";
import { createMemoryRateLimiter } from "@/server/adapters/memory-rate-limiter";
import { createFakeResourceStore, resetFakeResourceStore } from "@/server/adapters/fake-resource-store";
import type { FileStorage } from "@/server/ports/file-storage";
import type { ResourceStore } from "@/server/ports/resource-store";
import { newGroupCode, newInviteToken } from "@/server/groups/secrets";
import { FILE_MESSAGES } from "@/shared/file-messages";
import { DEFAULT_FORM_CONFIG, FORM_MESSAGES, type FormConfig } from "@/shared/form-config";
import { RESOURCE_LIMITS } from "@/shared/resources";
import {
  completeUpload,
  deleteFile,
  FILE_PAGE_SIZE,
  getFile,
  getFormForGroup,
  listFiles,
  openFile,
  prepareUpload,
  updateFile,
  type FileDeps,
} from "./use-cases";

const SITE = "https://app.test";
const MISSING_ID = "99999999-9999-4999-8999-999999999999";

const bytes = (...parts: (string | number[])[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));
const filler = (n: number) => new Array(n).fill(0x41);

const PDF = bytes("%PDF-1.7\n", filler(100));
const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], filler(50));
const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0], filler(50));
const GIF = bytes("GIF89a", filler(50));
const WEBP = bytes("RIFF", [1, 2, 3, 4], "WEBP", filler(50));
const ZIP = bytes([0x50, 0x4b, 0x03, 0x04], filler(50));
const OLE = bytes([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], filler(50));
const TEXT = bytes("hello, notes\n");
const HTML = bytes("<html><script>alert(1)</script></html>");

type Person = { id: string; displayName: string };

/** Everything on a test clock, over the fake stores and the fake storage; `as(person)` gives that person's deps. */
function setup(overrides: Partial<Pick<FileDeps, "resources" | "storage">> = {}) {
  resetFakeGroupStore();
  resetFakeResourceStore();
  resetFakeFileStorage();
  const auth = createFakeAuthStore();
  const groups = createFakeGroupStore(auth);
  const resources = createFakeResourceStore(auth);
  let now = Date.now();
  const storage = createFakeFileStorage({ siteUrl: SITE, now: () => now });
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
  const as = (user: Person): FileDeps => ({
    groups,
    limiter,
    siteUrl: SITE,
    ip: "10.0.0.1",
    user,
    resources,
    storage,
    ...overrides,
  });
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
  return { auth, groups, resources, storage, limiter, advance, person, as, makeGroup, getNow: () => now };
}

const details = (extra: Record<string, unknown> = {}) => ({
  title: "Unit 1 notes",
  typeId: "notes",
  typeOther: "",
  details: { subject: "Chemistry" },
  fileName: "unit1.pdf",
  contentType: "application/pdf",
  sizeBytes: PDF.length,
  ...extra,
});

/** What the edit form sends: the title, the type and the whole set of details. */
const edited = (extra: Record<string, unknown> = {}) => ({ title: "x", typeId: "notes", typeOther: "", details: {}, ...extra });

/** What the browser does with the link: PUT the bytes. Returns the HTTP status the storage answers. */
function sendFile(url: string, headers: Record<string, string>, body: Uint8Array, now?: () => number): number {
  const parsed = new URL(url);
  const key = parsed.pathname
    .slice("/api/test/storage/".length)
    .split("/")
    .map(decodeURIComponent)
    .join("/");
  const check = checkFakeUpload(
    { key, token: parsed.searchParams.get("token"), contentType: headers["Content-Type"] ?? null, declaredLength: body.length },
    now,
  );
  return check.ok ? check.accept(body) : check.status;
}

async function prepared(deps: FileDeps, groupId: string, raw: Record<string, unknown> = details()) {
  const result = await prepareUpload(deps, groupId, raw);
  if (!result.ok) throw new Error(`prepareUpload refused: ${JSON.stringify(result)}`);
  return result.data;
}

/** Prepare, send and complete: a ready file. */
async function uploadReady(deps: FileDeps, groupId: string, body = PDF, raw: Record<string, unknown> = {}) {
  const made = await prepared(deps, groupId, details({ sizeBytes: body.length, ...raw }));
  expect(sendFile(made.uploadUrl, made.headers, body)).toBe(200);
  const done = await completeUpload(deps, groupId, made.resourceId);
  if (!done.ok) throw new Error(`completeUpload refused: ${JSON.stringify(done)}`);
  return { ...made, view: done.data };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  resetFakeFileStorage();
});

describe("who may use the files of a group", () => {
  it("answers a stranger, a removed member, an unknown group and a malformed id exactly like a missing file", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const member = t.person("Ravi");
    const stranger = t.person("Mina");
    const removed = t.person("Gone");
    const groupId = await t.makeGroup(owner);
    await t.groups.addMember(groupId, member.id);
    await t.groups.addMember(groupId, removed.id);
    const file = await uploadReady(t.as(member), groupId);
    await t.groups.removeMember(groupId, removed.id);

    const otherGroup = await t.makeGroup(t.person("Someone else"));
    const attempts: [string, Person][] = [
      [groupId, stranger],
      [groupId, removed],
      [crypto.randomUUID(), owner],
      ["not-a-uuid", owner],
      [otherGroup, owner], // the owner of ANOTHER group, asking for this group's file id
    ];
    for (const [id, who] of attempts) {
      const deps = t.as(who);
      const answers = [
        await prepareUpload(deps, id, details()),
        await completeUpload(deps, id, file.resourceId),
        await updateFile(deps, id, file.resourceId, edited()),
        await getFormForGroup(deps, id),
        await deleteFile(deps, id, file.resourceId),
      ];
      for (const answer of answers) {
        if (answer === null) continue; // getFormForGroup: a read answers null, as listFiles does
        expect(answer).toEqual({ ok: false, notFound: true, formError: FILE_MESSAGES.notFound });
      }
      expect(await listFiles(deps, id)).toBeNull();
      expect(await openFile(deps, id, file.resourceId, { download: false })).toBeNull();
    }
    // Nothing changed: the file is still there.
    expect(await listFiles(t.as(member), groupId)).toMatchObject({ items: [{ id: file.resourceId }] });
    expect(getFakeFileStorageState().objects.size).toBe(1);
  });

  it("never serves a file under another group's address, even to someone who is a member of that group", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupA = await t.makeGroup(owner);
    const file = await uploadReady(t.as(owner), groupA);
    // The same person owns a second group and asks for group A's file id under group B's address.
    const groupB = await t.makeGroup(owner);
    const deps = t.as(owner);
    const notFound = { ok: false, notFound: true, formError: FILE_MESSAGES.notFound };
    expect(await openFile(deps, groupB, file.resourceId, { download: false })).toBeNull();
    expect(await openFile(deps, groupB, file.resourceId, { download: true })).toBeNull();
    expect(await updateFile(deps, groupB, file.resourceId, edited())).toEqual(notFound);
    expect(await deleteFile(deps, groupB, file.resourceId)).toEqual(notFound);
    expect(await completeUpload(deps, groupB, file.resourceId)).toEqual(notFound);
    expect(await listFiles(deps, groupB)).toMatchObject({ items: [] });
    // Under its own address it is still there and untouched.
    expect(await listFiles(deps, groupA)).toMatchObject({ items: [{ id: file.resourceId, title: "Unit 1 notes" }] });
  });

  it("answers a deleted group like a missing one", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    await uploadReady(t.as(owner), groupId);
    await t.groups.softDeleteGroup(groupId);
    expect(await listFiles(t.as(owner), groupId)).toBeNull();
    expect(await prepareUpload(t.as(owner), groupId, details())).toMatchObject({ ok: false, notFound: true });
  });

  it("a store failure while checking the group is a failure on actions and an error on reads, never 'not found'", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    const deps = t.as(owner);
    deps.groups = { ...deps.groups, findById: async () => Promise.reject(new Error("db down at groups/secret-key")) };
    expect(await prepareUpload(deps, groupId, details())).toEqual({ ok: false, formError: FILE_MESSAGES.couldNotSave });
    await expect(listFiles(deps, groupId)).rejects.toThrow();
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("secret-key");
  });
});

describe("prepareUpload", () => {
  it("records an 'uploading' file and returns a link bound to the canonical type and the size", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    const made = await prepared(t.as(owner), groupId);

    expect(made.resourceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(made.headers).toEqual({ "Content-Type": "application/pdf" });
    const url = new URL(made.uploadUrl);
    expect(url.origin).toBe(SITE);
    expect(decodeURIComponent(url.pathname)).toBe(`/api/test/storage/groups/${groupId}/${made.resourceId}.pdf`);

    const row = await t.resources.findById(groupId, made.resourceId);
    expect(row).toMatchObject({
      status: "uploading",
      uploaderId: owner.id,
      title: "Unit 1 notes",
      typeId: "notes",
      typeOther: "",
      details: { subject: "Chemistry" },
      fileName: "unit1.pdf",
      contentType: "application/pdf",
      sizeBytes: PDF.length,
      fileKey: `groups/${groupId}/${made.resourceId}.pdf`,
    });
  });

  it("an upload that was never completed is invisible: not listed, not opened, not edited, not deleted", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    const made = await prepared(t.as(owner), groupId);
    expect((await listFiles(t.as(owner), groupId))?.items).toEqual([]);
    expect((await listFiles(t.as(owner), groupId))?.filters.fields[0]?.options).toEqual([]);
    expect(await openFile(t.as(owner), groupId, made.resourceId, { download: true })).toBeNull();
    expect(await updateFile(t.as(owner), groupId, made.resourceId, edited())).toMatchObject({
      ok: false,
      notFound: true,
    });
    expect(await deleteFile(t.as(owner), groupId, made.resourceId)).toMatchObject({ ok: false, notFound: true });
  });

  it("trims the title and the answers, collapses spaces, and takes missing details and Other text as empty", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    const tidied = await prepared(
      t.as(owner),
      groupId,
      details({ title: "  Unit   1\tnotes \n", details: { subject: "  Applied \t Maths " }, typeOther: undefined }),
    );
    expect(await t.resources.findById(groupId, tidied.resourceId)).toMatchObject({
      title: "Unit 1 notes",
      typeId: "notes",
      typeOther: "",
      details: { subject: "Applied Maths" },
    });
    const bare = await prepared(t.as(owner), groupId, details({ details: undefined }));
    expect(await t.resources.findById(groupId, bare.resourceId)).toMatchObject({ details: {} });
    // An empty optional answer is not stored.
    const empty = await prepared(t.as(owner), groupId, details({ details: { subject: "   " } }));
    expect(await t.resources.findById(groupId, empty.resourceId)).toMatchObject({ details: {} });
  });

  it("cleans the file name for the stored key and name, whatever path or odd characters it came with", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    const made = await prepared(t.as(owner), groupId, details({ fileName: "C:\\Users\\me\\..\\..\\Unit 1: #notes?.PDF" }));
    const row = await t.resources.findById(groupId, made.resourceId);
    expect(row?.fileName).toBe("Unit 1_ _notes_.pdf");
    expect(row?.fileKey).toBe(`groups/${groupId}/${made.resourceId}.pdf`);
  });

  it("uses the canonical type when the browser sends no type or application/octet-stream", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    for (const contentType of ["", "application/octet-stream"]) {
      const made = await prepared(t.as(owner), groupId, details({ fileName: "slides.pptx", contentType }));
      expect(made.headers["Content-Type"]).toBe(
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      );
    }
  });

  it.each([
    ["a blank title", { title: "   " }, "title", FILE_MESSAGES.titleRequired],
    ["a missing title", { title: undefined }, "title", FILE_MESSAGES.titleRequired],
    ["a title over 120 characters", { title: "x".repeat(121) }, "title", FILE_MESSAGES.titleTooLong],
    ["a title with a NUL character", { title: "a\u0000b" }, "title", FILE_MESSAGES.oddCharacter],
    ["a subject over 100 characters", { details: { subject: "x".repeat(101) } }, "detail:subject", FORM_MESSAGES.tooLong(100)],
    ["an unknown type", { typeId: "memes" }, "type", FORM_MESSAGES.typeNotAvailable],
    ["no type", { typeId: undefined }, "type", FORM_MESSAGES.chooseType],
    ["an empty type", { typeId: "" }, "type", FORM_MESSAGES.chooseType],
    ["a type id over 64 characters", { typeId: "t".repeat(65) }, "type", FORM_MESSAGES.typeNotAvailable],
    ["Other without its text", { typeId: "other", typeOther: "  " }, "typeOther", FORM_MESSAGES.otherRequired],
    ["Other text over 40 characters", { typeId: "other", typeOther: "x".repeat(41) }, "typeOther", FORM_MESSAGES.tooLong(40)],
    ["a detail the form does not have", { details: { semester: "1" } }, "detail:semester", FORM_MESSAGES.detailUnknown],
    ["an SVG file", { fileName: "a.svg", contentType: "image/svg+xml" }, "fileName", FILE_MESSAGES.fileTypeNotAllowed],
    ["an HTML file", { fileName: "a.html", contentType: "text/html" }, "fileName", FILE_MESSAGES.fileTypeNotAllowed],
    ["a zip file", { fileName: "a.zip", contentType: "application/zip" }, "fileName", FILE_MESSAGES.fileTypeNotAllowed],
    ["an exe file", { fileName: "a.exe", contentType: "application/octet-stream" }, "fileName", FILE_MESSAGES.fileTypeNotAllowed],
    ["no extension", { fileName: "notes", contentType: "application/pdf" }, "fileName", FILE_MESSAGES.fileTypeNotAllowed],
    ["a pdf name with an html type", { contentType: "text/html" }, "fileName", FILE_MESSAGES.fileTypeNotAllowed],
    ["a double extension that ends in .exe", { fileName: "notes.pdf.exe" }, "fileName", FILE_MESSAGES.fileTypeNotAllowed],
    ["an empty file", { sizeBytes: 0 }, "sizeBytes", FILE_MESSAGES.fileEmpty],
    ["a file over the limit", { sizeBytes: RESOURCE_LIMITS.maxFileBytes + 1 }, "sizeBytes", FILE_MESSAGES.fileTooBig],
    ["a fractional size", { sizeBytes: 10.5 }, "sizeBytes", FILE_MESSAGES.chooseFile],
    ["a size sent as text", { sizeBytes: "10" }, "sizeBytes", FILE_MESSAGES.chooseFile],
  ])("refuses %s with a field error and creates nothing", async (_name, change, field, message) => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    const result = await prepareUpload(t.as(owner), groupId, details(change));
    expect(result).toMatchObject({ ok: false, fieldErrors: { [field]: message } });
    expect((await t.resources.list(groupId, { limit: 50 })).items).toEqual([]);
    expect(getFakeFileStorageState().grants.size).toBe(0);
  });

  it("accepts a file of exactly the largest size", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    const result = await prepareUpload(t.as(owner), groupId, details({ sizeBytes: RESOURCE_LIMITS.maxFileBytes }));
    expect(result.ok).toBe(true);
  });

  it("reports several field errors together, and a form that is not an object as a form error", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    const result = await prepareUpload(t.as(owner), groupId, details({ title: "", fileName: "x.svg", sizeBytes: 0 }));
    expect(result).toMatchObject({ ok: false, fieldErrors: { title: expect.any(String), fileName: expect.any(String), sizeBytes: expect.any(String) } });
    expect(await prepareUpload(t.as(owner), groupId, null)).toEqual({ ok: false, formError: FILE_MESSAGES.badForm });
  });

  it("allows 15 a person an hour, then refuses with the too-many message until the hour is up", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const other = t.person("Ravi");
    const groupId = await t.makeGroup(owner);
    await t.groups.addMember(groupId, other.id);
    for (let i = 0; i < 15; i++) expect((await prepareUpload(t.as(owner), groupId, details())).ok).toBe(true);
    const refused = await prepareUpload(t.as(owner), groupId, details());
    expect(refused).toMatchObject({ ok: false, formError: FILE_MESSAGES.tooMany, retryAfterSeconds: expect.any(Number) });
    // Another person has their own budget.
    expect((await prepareUpload(t.as(other), groupId, details())).ok).toBe(true);
    t.advance(60 * 60 + 1);
    expect((await prepareUpload(t.as(owner), groupId, details())).ok).toBe(true);
  });

  it("a bad form does not use up the budget", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    for (let i = 0; i < 40; i++) await prepareUpload(t.as(owner), groupId, details({ title: "" }));
    expect((await prepareUpload(t.as(owner), groupId, details())).ok).toBe(true);
  });

  it("lets the upload through when the limiter is down", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    const deps = t.as(owner);
    deps.limiter = { hit: () => Promise.reject(new Error("db down")), peek: () => Promise.reject(new Error("db down")) } as never;
    expect((await prepareUpload(deps, groupId, details())).ok).toBe(true);
    expect(console.warn).toHaveBeenCalledWith("Rate limit store unavailable; allowing the request.");
  });

  it("when the link cannot be made, deletes the row and says so generically, without the error's text", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    const storage: FileStorage = {
      ...t.storage,
      createUploadUrl: async () => {
        throw new Error("AccessDenied bucket=secret-bucket key=groups/abc");
      },
    };
    const deps = t.as(owner);
    deps.storage = storage;
    const result = await prepareUpload(deps, groupId, details());
    expect(result).toEqual({ ok: false, formError: FILE_MESSAGES.couldNotStartUpload });
    expect(JSON.stringify(result)).not.toContain("secret-bucket");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toMatch(/secret-bucket|groups\//);
    // The row is soft deleted: gone from every read.
    expect((await t.resources.list(groupId, { limit: 50 })).items).toEqual([]);
    const all = [...(getFakeStateRows())];
    expect(all.every((e) => e.deletedAt !== null)).toBe(true);
    expect(all).toHaveLength(1);
  });

  it("when the row cannot be saved, answers generically and creates no link", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    const resources: ResourceStore = {
      ...t.resources,
      createPending: async () => {
        throw new Error('duplicate key value violates unique constraint "resources_file_key_unique" (groups/x)');
      },
    };
    const deps = t.as(owner);
    deps.resources = resources;
    const result = await prepareUpload(deps, groupId, details());
    expect(result).toEqual({ ok: false, formError: FILE_MESSAGES.couldNotStartUpload });
    expect(getFakeFileStorageState().grants.size).toBe(0);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toMatch(/unique|groups\//);
  });
});

/** The fake resource store's rows, including deleted ones, to check soft deletes. */
function getFakeStateRows() {
  const g = globalThis as unknown as Record<string, { resources: Map<string, { deletedAt: Date | null }> }>;
  return g["__studyShareFakeResourceStore"].resources.values();
}

describe("the link the browser gets", () => {
  it("accepts the right file once, and refuses a repeat", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    const made = await prepared(t.as(owner), groupId);
    expect(sendFile(made.uploadUrl, made.headers, PDF)).toBe(200);
    expect(sendFile(made.uploadUrl, made.headers, PDF)).toBe(403);
  });

  it("refuses another size, another type and an expired link", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    const made = await prepared(t.as(owner), groupId);
    expect(sendFile(made.uploadUrl, made.headers, bytes("%PDF-", filler(5)))).toBe(403);
    expect(sendFile(made.uploadUrl, { "Content-Type": "text/html" }, PDF)).toBe(403);
    t.advance(601);
    expect(sendFile(made.uploadUrl, made.headers, PDF, t.getNow)).toBe(403);
    expect(getFakeFileStorageState().objects.size).toBe(0);
  });
});

describe("completeUpload", () => {
  it("marks a verified file ready and returns it without its storage key", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    const { view, resourceId } = await uploadReady(t.as(owner), groupId);
    expect(view).toMatchObject({ id: resourceId, title: "Unit 1 notes", fileName: "unit1.pdf", sizeBytes: PDF.length, previewable: true });
    expect(JSON.stringify(view)).not.toContain("groups/");
    expect((await t.resources.findById(groupId, resourceId))?.status).toBe("ready");
    expect((await listFiles(t.as(owner), groupId))?.items.map((i) => i.id)).toEqual([resourceId]);
  });

  it("is safe to repeat", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    const { resourceId } = await uploadReady(t.as(owner), groupId);
    const again = await completeUpload(t.as(owner), groupId, resourceId);
    expect(again).toMatchObject({ ok: true, data: { id: resourceId } });
  });

  it("only the uploader may complete: another member gets 'not found' and nothing changes", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const member = t.person("Ravi");
    const groupId = await t.makeGroup(owner);
    await t.groups.addMember(groupId, member.id);
    const made = await prepared(t.as(member), groupId);
    sendFile(made.uploadUrl, made.headers, PDF);
    expect(await completeUpload(t.as(owner), groupId, made.resourceId)).toEqual({
      ok: false,
      notFound: true,
      formError: FILE_MESSAGES.notFound,
    });
    expect((await t.resources.findById(groupId, made.resourceId))?.status).toBe("uploading");
    expect(await completeUpload(t.as(member), groupId, made.resourceId)).toMatchObject({ ok: true });
  });

  it("an unknown or malformed file id is 'not found'", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    for (const id of [MISSING_ID, "nope"]) {
      expect(await completeUpload(t.as(owner), groupId, id)).toMatchObject({ ok: false, notFound: true });
    }
  });

  it("a person who has left the group can no longer complete", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const member = t.person("Ravi");
    const groupId = await t.makeGroup(owner);
    await t.groups.addMember(groupId, member.id);
    const made = await prepared(t.as(member), groupId);
    sendFile(made.uploadUrl, made.headers, PDF);
    await t.groups.removeMember(groupId, member.id);
    expect(await completeUpload(t.as(member), groupId, made.resourceId)).toMatchObject({ ok: false, notFound: true });
  });

  it("when nothing was uploaded, says so, and marks the row deleted", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    const made = await prepared(t.as(owner), groupId);
    expect(await completeUpload(t.as(owner), groupId, made.resourceId)).toEqual({
      ok: false,
      formError: FILE_MESSAGES.uploadMissing,
    });
    expect(await t.resources.findById(groupId, made.resourceId)).toBeNull();
  });

  it("when a different size reached storage, deletes the object and the row", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    const made = await prepared(t.as(owner), groupId);
    const key = `groups/${groupId}/${made.resourceId}.pdf`;
    await t.storage.put(key, bytes("%PDF-", filler(3)), "application/pdf");
    expect(await completeUpload(t.as(owner), groupId, made.resourceId)).toEqual({
      ok: false,
      formError: FILE_MESSAGES.uploadMissing,
    });
    expect(await t.storage.head(key)).toBeNull();
    expect(await t.resources.findById(groupId, made.resourceId)).toBeNull();
  });

  it("when the content is not the promised type, deletes the object and the row and names the type", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    const made = await prepared(t.as(owner), groupId, details({ sizeBytes: HTML.length }));
    expect(sendFile(made.uploadUrl, made.headers, HTML)).toBe(200);
    const key = `groups/${groupId}/${made.resourceId}.pdf`;
    expect(await t.storage.head(key)).not.toBeNull();

    const result = await completeUpload(t.as(owner), groupId, made.resourceId);
    expect(result).toEqual({ ok: false, formError: FILE_MESSAGES.doesNotLookLike("PDF") });
    expect(result).toMatchObject({ formError: expect.stringContaining("does not look like a PDF") });
    expect(await t.storage.head(key)).toBeNull();
    expect(await t.resources.findById(groupId, made.resourceId)).toBeNull();
    expect((await listFiles(t.as(owner), groupId))?.items).toEqual([]);
  });

  // [file name, good bytes, the other kinds' bytes that must not pass, label]
  it.each([
    ["a.pdf", PDF, [PNG, ZIP, HTML, TEXT]],
    ["a.png", PNG, [PDF, JPEG, GIF, HTML]],
    ["a.jpg", JPEG, [PNG, PDF, HTML]],
    ["a.jpeg", JPEG, [PNG, HTML]],
    ["a.gif", GIF, [PNG, HTML]],
    ["a.webp", WEBP, [PNG, bytes("RIFF", [1, 2, 3, 4], "WAVE", filler(20)), HTML]],
    ["a.docx", ZIP, [PDF, OLE, HTML, TEXT]],
    ["a.pptx", ZIP, [PDF, OLE, HTML]],
    ["a.xlsx", ZIP, [PDF, OLE, HTML]],
    ["a.doc", OLE, [PDF, ZIP, HTML]],
    ["a.ppt", OLE, [PDF, ZIP, HTML]],
    ["a.xls", OLE, [PDF, ZIP, HTML]],
    ["a.txt", TEXT, [bytes("ab", [0], "cd"), bytes([0xff, 0, 0x41, 0])]],
    ["a.csv", TEXT, [bytes("a,b", [0, 0])]],
  ])("%s: only matching bytes pass", async (fileName, good, bad) => {
    for (const body of [good, ...bad]) {
      const t = setup();
      const owner = t.person("Asha");
      const groupId = await t.makeGroup(owner);
      const made = await prepared(t.as(owner), groupId, details({ fileName, contentType: "", sizeBytes: body.length }));
      expect(sendFile(made.uploadUrl, made.headers, body)).toBe(200);
      const result = await completeUpload(t.as(owner), groupId, made.resourceId);
      expect(result.ok).toBe(body === good);
    }
  });

  it("a file can still be a truncated header: too short to match is refused", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    const body = bytes("%PD");
    const made = await prepared(t.as(owner), groupId, details({ sizeBytes: body.length }));
    sendFile(made.uploadUrl, made.headers, body);
    expect((await completeUpload(t.as(owner), groupId, made.resourceId)).ok).toBe(false);
  });

  it("reads only the first 4096 bytes of a big file", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    const big = bytes("%PDF-", filler(100_000));
    const get = vi.spyOn(t.storage, "get");
    const deps = t.as(owner);
    await uploadReady(deps, groupId, big);
    expect(get).toHaveBeenCalledWith(expect.any(String), { range: { start: 0, endInclusive: 4095 } });
  });

  it("a storage failure (not a bad file) changes nothing and can be retried", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    const made = await prepared(t.as(owner), groupId);
    sendFile(made.uploadUrl, made.headers, PDF);
    let broken = true;
    const flaky: FileStorage = {
      ...t.storage,
      head: async (key) => {
        if (broken) throw new Error("socket hang up groups/secret");
        return t.storage.head(key);
      },
    };
    const deps = t.as(owner);
    deps.storage = flaky;
    const failed = await completeUpload(deps, groupId, made.resourceId);
    expect(failed).toEqual({ ok: false, formError: FILE_MESSAGES.couldNotSave });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("secret");
    expect(getFakeFileStorageState().objects.size).toBe(1);
    expect((await t.resources.findById(groupId, made.resourceId))?.status).toBe("uploading");
    broken = false;
    expect((await completeUpload(deps, groupId, made.resourceId)).ok).toBe(true);
  });

  it("still rejects a bad file when the clean-up itself fails, logging only fixed lines", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    const made = await prepared(t.as(owner), groupId, details({ sizeBytes: HTML.length }));
    sendFile(made.uploadUrl, made.headers, HTML);
    const deps = t.as(owner);
    deps.storage = { ...t.storage, delete: async () => Promise.reject(new Error("denied groups/secret")) };
    const result = await completeUpload(deps, groupId, made.resourceId);
    expect(result).toMatchObject({ ok: false, formError: expect.stringContaining("does not look like") });
    expect(await t.resources.findById(groupId, made.resourceId)).toBeNull();
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("secret");
  });
});

describe("listFiles", () => {
  it("returns client-safe views, newest first, with the filter choices", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const member = t.person("Ravi");
    const groupId = await t.makeGroup(owner);
    await t.groups.addMember(groupId, member.id);
    const first = await uploadReady(t.as(member), groupId, PDF, { title: "Older", details: { subject: "Physics" } });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await uploadReady(t.as(owner), groupId, PNG, {
      title: "Newer",
      details: { subject: "Chemistry" },
      fileName: "board.png",
      contentType: "image/png",
      typeId: "pyq",
    });

    const list = await listFiles(t.as(member), groupId);
    expect(list?.items.map((i) => i.id)).toEqual([second.resourceId, first.resourceId]);
    expect(list?.nextCursor).toBeNull();
    expect(list?.filters.fields[0]?.options.map((option) => option.label)).toEqual(["Chemistry", "Physics"]);
    expect(list?.items[0]).toEqual({
      id: second.resourceId,
      title: "Newer",
      typeId: "pyq",
      typeLabel: "Previous year paper",
      typeRemoved: false,
      typeOther: "",
      details: [{ fieldId: "subject", label: "Subject", display: "Chemistry", value: "Chemistry", valueRemoved: false, removed: false }],
      fileName: "board.png",
      sizeBytes: PNG.length,
      uploaderName: "Asha",
      uploadedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
      previewable: true,
      isPdf: false,
      canDelete: false,
      canEdit: false,
    });
    // The text carries no keys or ids beyond the file's own.
    expect(JSON.stringify(list)).not.toContain("groups/");
    expect(JSON.stringify(list)).not.toContain(owner.id);
    expect(JSON.stringify(list)).not.toContain(groupId);
  });

  it("says who may edit and delete: the uploader both, the owner delete only, another member neither", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const member = t.person("Ravi");
    const other = t.person("Mina");
    const groupId = await t.makeGroup(owner);
    await t.groups.addMember(groupId, member.id);
    await t.groups.addMember(groupId, other.id);
    await uploadReady(t.as(member), groupId);
    const flags = async (who: Person) => {
      const item = (await listFiles(t.as(who), groupId))?.items[0];
      return [item?.canEdit, item?.canDelete];
    };
    expect(await flags(member)).toEqual([true, true]);
    expect(await flags(owner)).toEqual([false, true]);
    expect(await flags(other)).toEqual([false, false]);
  });

  it("shows 'Former member' when the uploader's account is gone", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const member = t.person("Ravi");
    const groupId = await t.makeGroup(owner);
    await t.groups.addMember(groupId, member.id);
    await uploadReady(t.as(member), groupId);
    t.auth.users.delete(member.id);
    const item = (await listFiles(t.as(owner), groupId))?.items[0];
    expect(item).toMatchObject({ uploaderName: "Former member", canEdit: false, canDelete: true });
  });

  it("pages by 20 and continues with the cursor", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    for (let i = 0; i < FILE_PAGE_SIZE + 5; i++) {
      await t.resources.createPending({
        id: crypto.randomUUID(),
        groupId,
        uploaderId: owner.id,
        title: `File ${i}`,
        typeId: "notes",
        typeOther: "",
        details: {},
        fileKey: `k-${i}`,
        fileName: `f${i}.pdf`,
        contentType: "application/pdf",
        sizeBytes: 5,
      }).then((r) => t.resources.markReady(r.id, groupId));
    }
    const page1 = await listFiles(t.as(owner), groupId);
    expect(page1?.items).toHaveLength(20);
    expect(page1?.nextCursor).toEqual(expect.any(String));
    const page2 = await listFiles(t.as(owner), groupId, { cursor: page1?.nextCursor ?? "" });
    expect(page2?.items).toHaveLength(5);
    expect(page2?.nextCursor).toBeNull();
    const ids = [...(page1?.items ?? []), ...(page2?.items ?? [])].map((i) => i.id);
    expect(new Set(ids).size).toBe(25);
  });

  it("passes search, type and detail filters through (they combine), and ignores what makes no sense", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    await uploadReady(t.as(owner), groupId, PDF, { title: "Organic reactions", details: { subject: "Chemistry" }, typeId: "notes" });
    await uploadReady(t.as(owner), groupId, PDF, { title: "Organic past paper", details: { subject: "Chemistry" }, typeId: "pyq" });
    await uploadReady(t.as(owner), groupId, PDF, { title: "Kinematics", details: { subject: "Physics" }, typeId: "notes" });
    const titles = async (query: Record<string, unknown>) =>
      ((await listFiles(t.as(owner), groupId, query))?.items ?? []).map((i) => i.title).sort();

    expect(await titles({ q: "organic" })).toEqual(["Organic past paper", "Organic reactions"]);
    expect(await titles({ q: "organic", typeId: "pyq" })).toEqual(["Organic past paper"]);
    expect(await titles({ details: { subject: "chemistry" }, typeId: "notes" })).toEqual(["Organic reactions"]);
    expect(await titles({ q: "  " })).toHaveLength(3);
    // A text detail is found by its value too, with capitals ignored.
    expect(await titles({ q: "PHYSICS" })).toEqual(["Kinematics"]);
    // The choices are for the filter: they do not shrink with the filters.
    const filtered = await listFiles(t.as(owner), groupId, { typeId: "pyq" });
    expect(filtered?.filters.fields[0]?.options.map((option) => option.label)).toEqual(["Chemistry", "Physics"]);
  });

  it("an odd query never throws and never matches more than it should", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    await uploadReady(t.as(owner), groupId, PDF, { title: "Kept", details: { subject: "Chemistry" } });
    const titles = async (query: unknown) =>
      ((await listFiles(t.as(owner), groupId, query as never))?.items ?? []).map((i) => i.title);

    // A type the group does not have (an old link, a typo) matches nothing; so do too-long or odd ones.
    expect(await titles({ typeId: "memes" })).toEqual([]);
    expect(await titles({ typeId: "NOTES" })).toEqual([]);
    expect(await titles({ typeId: "t".repeat(65) })).toEqual([]);
    expect(await titles({ typeId: "a\u0000b" })).toEqual([]);
    expect(await titles({ typeId: "toString" })).toEqual([]);
    // A detail value no file can have matches nothing.
    expect(await titles({ details: { subject: "x".repeat(101) } })).toEqual([]);
    expect(await titles({ details: { subject: "a\u0000b" } })).toEqual([]);
    expect(await titles({ details: { subject: "Physics" } })).toEqual([]);
    // A detail the form does not have is ignored: nothing is filtered and nothing is read.
    expect(await titles({ details: { zzz: "x", toString: "x", constructor: "x" } })).toEqual(["Kept"]);
    expect(await titles({ details: JSON.parse('{"__proto__":"x","subject":""}') })).toEqual(["Kept"]);
    // Wrong kinds of values and shapes are taken as not set.
    expect(await titles({ q: 5, typeId: 5, details: "subject", cursor: 5 })).toEqual(["Kept"]);
    expect(await titles({ details: ["Chemistry"] })).toEqual(["Kept"]);
    expect(await titles({ details: { subject: 5 } })).toEqual(["Kept"]);
    expect(await titles(null)).toEqual(["Kept"]);
    // A matching file is still found with the same address, tidied like an answer.
    expect(await titles({ details: { subject: "  chemistry " } })).toEqual(["Kept"]);
  });

  it("cuts a search to 100 characters and turns control characters into spaces before the store sees them", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    const list = vi.spyOn(t.resources, "list");
    const deps = t.as(owner);
    await listFiles(deps, groupId, { q: `a\u0000b${"x".repeat(300)}` });
    const sent = list.mock.calls[0][1];
    expect([...(sent.search?.text ?? "")].length).toBeLessThanOrEqual(RESOURCE_LIMITS.maxTitle);
    expect([...(sent.search?.text ?? "")].length).toBe(100);
    expect(sent.search?.text).not.toContain("\u0000");
    expect(sent.search?.text.startsWith("a b")).toBe(true);
    expect(sent.limit).toBe(20);
  });

  it("ignores a cursor that is not a cursor (first page)", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    await uploadReady(t.as(owner), groupId);
    expect((await listFiles(t.as(owner), groupId, { cursor: "garbage!!" }))?.items).toHaveLength(1);
  });
});

describe("getFile", () => {
  it("shows a ready file with what the caller may do, and never the storage key", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const member = t.person("Ravi");
    const groupId = await t.makeGroup(owner);
    await t.groups.addMember(groupId, member.id);
    const { resourceId } = await uploadReady(t.as(member), groupId);
    const own = await getFile(t.as(member), groupId, resourceId);
    expect(own).toMatchObject({ id: resourceId, title: "Unit 1 notes", uploaderName: "Ravi", previewable: true, canEdit: true, canDelete: true });
    expect(JSON.stringify(own)).not.toContain("groups/");
    expect(await getFile(t.as(owner), groupId, resourceId)).toMatchObject({ canEdit: false, canDelete: true });
  });

  it("answers null for a stranger, a bad id, a missing file and an unfinished upload", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const stranger = t.person("Zed");
    const groupId = await t.makeGroup(owner);
    const { resourceId } = await uploadReady(t.as(owner), groupId);
    expect(await getFile(t.as(stranger), groupId, resourceId)).toBeNull();
    expect(await getFile(t.as(owner), groupId, "nope")).toBeNull();
    expect(await getFile(t.as(owner), groupId, MISSING_ID)).toBeNull();
    const pending = await prepareUpload(t.as(owner), groupId, details());
    expect(pending.ok).toBe(true);
    if (pending.ok) expect(await getFile(t.as(owner), groupId, pending.data.resourceId)).toBeNull();
  });
});

describe("openFile", () => {
  it("gives a preview link for a PDF: inline, short-lived, with the file's name", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    const { resourceId } = await uploadReady(t.as(owner), groupId);
    const opened = await openFile(t.as(owner), groupId, resourceId, { download: false });
    expect(opened).toMatchObject({
      previewable: true,
      title: "Unit 1 notes",
      fileName: "unit1.pdf",
      contentType: "application/pdf",
    });
    const url = new URL(opened?.url ?? "");
    expect(url.searchParams.get("disposition")).toBe("inline");
    const served = readFakeDownload(
      decodeURIComponent(url.pathname.slice("/api/test/storage/".length)),
      url.searchParams.get("token"),
      t.getNow,
    );
    expect(served.status).toBe(200);
    if (served.status === 200) {
      expect(served.headers["Content-Type"]).toBe("application/pdf");
      expect(served.headers["Content-Disposition"]).toMatch(/^inline; filename="unit1.pdf"/);
      expect(served.bytes).toEqual(PDF);
    }
    // 300 seconds, as the brief says.
    t.advance(301);
    expect(readFakeDownload(decodeURIComponent(url.pathname.slice("/api/test/storage/".length)), url.searchParams.get("token"), t.getNow).status).toBe(403);
  });

  it("forces a download when asked, and for files a browser should not show", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    const pdf = await uploadReady(t.as(owner), groupId);
    const doc = await uploadReady(t.as(owner), groupId, ZIP, { fileName: "essay.docx", contentType: "" });

    const forced = await openFile(t.as(owner), groupId, pdf.resourceId, { download: true });
    expect(forced?.previewable).toBe(true);
    expect(new URL(forced?.url ?? "").searchParams.get("disposition")).toBe("attachment");

    const word = await openFile(t.as(owner), groupId, doc.resourceId, { download: false });
    expect(word?.previewable).toBe(false);
    expect(word?.contentType).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(new URL(word?.url ?? "").searchParams.get("disposition")).toBe("attachment");
  });

  it("decides from the stored type: a file recorded as something unsafe is a download whatever the name says", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    const row = await t.resources.createPending({
      id: crypto.randomUUID(),
      groupId,
      uploaderId: owner.id,
      title: "Odd",
      typeId: "other",
      typeOther: "",
      details: {},
      fileKey: "odd-key",
      fileName: "page.pdf",
      contentType: "text/html",
      sizeBytes: 5,
    });
    await t.resources.markReady(row.id, groupId);
    const opened = await openFile(t.as(owner), groupId, row.id, { download: false });
    expect(opened?.previewable).toBe(false);
    expect(new URL(opened?.url ?? "").searchParams.get("disposition")).toBe("attachment");
  });

  it("every other member of the group may open it; a removed member never again", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const member = t.person("Ravi");
    const groupId = await t.makeGroup(owner);
    await t.groups.addMember(groupId, member.id);
    const { resourceId } = await uploadReady(t.as(owner), groupId);
    expect(await openFile(t.as(member), groupId, resourceId, { download: true })).not.toBeNull();
    await t.groups.removeMember(groupId, member.id);
    expect(await openFile(t.as(member), groupId, resourceId, { download: true })).toBeNull();
  });

  it("is null for an unknown, malformed or deleted file", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    const { resourceId } = await uploadReady(t.as(owner), groupId);
    await deleteFile(t.as(owner), groupId, resourceId);
    for (const id of [resourceId, MISSING_ID, "nope"]) {
      expect(await openFile(t.as(owner), groupId, id, { download: false })).toBeNull();
    }
  });

  it("throws a generic error, with no key in it, when the link cannot be made", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    const { resourceId } = await uploadReady(t.as(owner), groupId);
    const deps = t.as(owner);
    deps.storage = { ...t.storage, createDownloadUrl: async () => Promise.reject(new Error("bad key groups/secret")) };
    await expect(openFile(deps, groupId, resourceId, { download: false })).rejects.toThrow("File link failed");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("secret");
  });
});

describe("updateFile", () => {
  const edit = { title: "Better title", typeId: "assignment", typeOther: "", details: { subject: "Organic" } };

  it("lets the uploader change the details", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const member = t.person("Ravi");
    const groupId = await t.makeGroup(owner);
    await t.groups.addMember(groupId, member.id);
    const { resourceId } = await uploadReady(t.as(member), groupId);
    const result = await updateFile(t.as(member), groupId, resourceId, { ...edit, title: "  Better   title " });
    expect(result).toMatchObject({
      ok: true,
      data: {
        title: "Better title",
        typeId: "assignment",
        typeLabel: "Assignment",
        details: [{ fieldId: "subject", display: "Organic" }],
      },
    });
    expect(await t.resources.findById(groupId, resourceId)).toMatchObject({
      title: "Better title",
      typeId: "assignment",
      details: { subject: "Organic" },
    });
  });

  it("does not let the owner, or anyone else, edit another person's file", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const member = t.person("Ravi");
    const groupId = await t.makeGroup(owner);
    await t.groups.addMember(groupId, member.id);
    const { resourceId } = await uploadReady(t.as(member), groupId);
    expect(await updateFile(t.as(owner), groupId, resourceId, edit)).toEqual({
      ok: false,
      notFound: true,
      formError: FILE_MESSAGES.notFound,
    });
    expect(await t.resources.findById(groupId, resourceId)).toMatchObject({ title: "Unit 1 notes" });
  });

  it("gives field errors for a bad form, only to someone who may edit", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const member = t.person("Ravi");
    const groupId = await t.makeGroup(owner);
    await t.groups.addMember(groupId, member.id);
    const { resourceId } = await uploadReady(t.as(owner), groupId);
    const bad = { title: "", typeId: "memes", typeOther: "", details: { subject: "x".repeat(101) } };
    expect(await updateFile(t.as(owner), groupId, resourceId, bad)).toMatchObject({
      ok: false,
      fieldErrors: { title: expect.any(String), "detail:subject": expect.any(String), type: expect.any(String) },
    });
    // The other member learns nothing from the form check.
    expect(await updateFile(t.as(member), groupId, resourceId, bad)).toMatchObject({ ok: false, notFound: true });
    expect(await updateFile(t.as(owner), groupId, resourceId, null)).toEqual({ ok: false, formError: FILE_MESSAGES.badForm });
  });

  it("is 'not found' for an unknown file and a failure for a store error", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    const { resourceId } = await uploadReady(t.as(owner), groupId);
    expect(await updateFile(t.as(owner), groupId, MISSING_ID, edit)).toMatchObject({ ok: false, notFound: true });
    const deps = t.as(owner);
    deps.resources = { ...t.resources, update: async () => Promise.reject(new Error("deadlock groups/secret")) };
    expect(await updateFile(deps, groupId, resourceId, edit)).toEqual({ ok: false, formError: FILE_MESSAGES.couldNotSave });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("secret");
  });
});

describe("deleteFile", () => {
  it("lets the uploader delete their own file, from the list and from storage", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const member = t.person("Ravi");
    const groupId = await t.makeGroup(owner);
    await t.groups.addMember(groupId, member.id);
    const { resourceId } = await uploadReady(t.as(member), groupId);
    expect(getFakeFileStorageState().objects.size).toBe(1);
    expect(await deleteFile(t.as(member), groupId, resourceId)).toEqual({ ok: true, data: undefined });
    expect((await listFiles(t.as(member), groupId))?.items).toEqual([]);
    expect(getFakeFileStorageState().objects.size).toBe(0);
  });

  it("lets the owner delete anyone's file", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const member = t.person("Ravi");
    const groupId = await t.makeGroup(owner);
    await t.groups.addMember(groupId, member.id);
    const { resourceId } = await uploadReady(t.as(member), groupId);
    expect(await deleteFile(t.as(owner), groupId, resourceId)).toEqual({ ok: true, data: undefined });
    expect(getFakeFileStorageState().objects.size).toBe(0);
  });

  it("does not let a member delete someone else's file", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const member = t.person("Ravi");
    const other = t.person("Mina");
    const groupId = await t.makeGroup(owner);
    await t.groups.addMember(groupId, member.id);
    await t.groups.addMember(groupId, other.id);
    const { resourceId } = await uploadReady(t.as(owner), groupId);
    expect(await deleteFile(t.as(other), groupId, resourceId)).toEqual({
      ok: false,
      notFound: true,
      formError: FILE_MESSAGES.notFound,
    });
    expect(getFakeFileStorageState().objects.size).toBe(1);
    expect((await listFiles(t.as(member), groupId))?.items).toHaveLength(1);
  });

  it("a second delete is 'not found'; an unknown id too", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    const { resourceId } = await uploadReady(t.as(owner), groupId);
    await deleteFile(t.as(owner), groupId, resourceId);
    expect(await deleteFile(t.as(owner), groupId, resourceId)).toMatchObject({ ok: false, notFound: true });
    expect(await deleteFile(t.as(owner), groupId, MISSING_ID)).toMatchObject({ ok: false, notFound: true });
  });

  it("still succeeds when storage cannot delete, logging a fixed line without the key", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    const { resourceId } = await uploadReady(t.as(owner), groupId);
    const deps = t.as(owner);
    deps.storage = { ...t.storage, delete: async () => Promise.reject(new Error("AccessDenied groups/secret-key")) };
    expect(await deleteFile(deps, groupId, resourceId)).toEqual({ ok: true, data: undefined });
    expect((await listFiles(deps, groupId))?.items).toEqual([]);
    expect(console.error).toHaveBeenCalledWith("Could not remove a deleted file from storage.");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toMatch(/secret|groups\//);
  });

  it("a store failure leaves the file in place and answers with a failure", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    const { resourceId } = await uploadReady(t.as(owner), groupId);
    const deps = t.as(owner);
    deps.resources = { ...t.resources, softDelete: async () => Promise.reject(new Error("boom groups/secret")) };
    expect(await deleteFile(deps, groupId, resourceId)).toEqual({ ok: false, formError: FILE_MESSAGES.couldNotSave });
    expect(getFakeFileStorageState().objects.size).toBe(1);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("secret");
  });

  it("a removed member cannot delete their own file any more", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const member = t.person("Ravi");
    const groupId = await t.makeGroup(owner);
    await t.groups.addMember(groupId, member.id);
    const { resourceId } = await uploadReady(t.as(member), groupId);
    await t.groups.removeMember(groupId, member.id);
    expect(await deleteFile(t.as(member), groupId, resourceId)).toMatchObject({ ok: false, notFound: true });
    expect(getFakeFileStorageState().objects.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
// A group with its own upload form

/**
 * A class group's form: two types (and a removed one), a REQUIRED dropdown with a removed choice,
 * an optional text detail, and a removed text detail.
 */
const CLASS_CONFIG: FormConfig = {
  version: 1,
  types: [
    { id: "t_notes", label: "Lecture notes" },
    { id: "t_lab", label: "Lab report" },
    { id: "t_old", label: "Old exam", archived: true },
  ],
  fields: [
    {
      id: "f_sem",
      label: "Semester",
      kind: "dropdown",
      required: true,
      options: [
        { id: "o_1", label: "Sem 1" },
        { id: "o_2", label: "Sem 2" },
        { id: "o_3", label: "Semester 3", archived: true },
      ],
    },
    { id: "f_subject", label: "Subject", kind: "text", required: false },
    { id: "f_year", label: "Year", kind: "text", required: false, archived: true },
  ],
};

/** A group on CLASS_CONFIG. */
async function classGroup(t: ReturnType<typeof setup>, owner: Person, config: FormConfig = CLASS_CONFIG) {
  const groupId = await t.makeGroup(owner);
  expect(setFakeGroupFormConfig(groupId, config)).toBe(true);
  return groupId;
}

const classUpload = (extra: Record<string, unknown> = {}) => details({ typeId: "t_notes", details: { f_sem: "o_1" }, ...extra });

/** A ready file put straight into the store, the way an old file or one from before a form change is. */
async function seedReady(
  t: ReturnType<typeof setup>,
  groupId: string,
  uploader: Person,
  extra: { title?: string; typeId?: string; typeOther?: string; details?: Record<string, string> } = {},
) {
  const id = crypto.randomUUID();
  await t.resources.createPending({
    id,
    groupId,
    uploaderId: uploader.id,
    title: extra.title ?? "Seeded",
    typeId: extra.typeId ?? "t_notes",
    typeOther: extra.typeOther ?? "",
    details: extra.details ?? {},
    fileKey: `seed-${id}`,
    fileName: "seed.pdf",
    contentType: "application/pdf",
    sizeBytes: 5,
  });
  await t.resources.markReady(id, groupId);
  return id;
}

describe("getFormForGroup", () => {
  it("gives every active member the group's form, the default one for a group that never changed it", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const member = t.person("Ravi");
    const plain = await t.makeGroup(owner);
    const custom = await classGroup(t, owner);
    await t.groups.addMember(custom, member.id);
    expect(await getFormForGroup(t.as(owner), plain)).toEqual({ formConfig: DEFAULT_FORM_CONFIG });
    expect(await getFormForGroup(t.as(owner), custom)).toEqual({ formConfig: CLASS_CONFIG });
    expect(await getFormForGroup(t.as(member), custom)).toEqual({ formConfig: CLASS_CONFIG });
  });

  it("is null, like the other reads, for a stranger, a removed member, a deleted group and a bad id; a store failure throws", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const removed = t.person("Gone");
    const groupId = await classGroup(t, owner);
    await t.groups.addMember(groupId, removed.id);
    await t.groups.removeMember(groupId, removed.id);
    expect(await getFormForGroup(t.as(t.person("Stranger")), groupId)).toBeNull();
    expect(await getFormForGroup(t.as(removed), groupId)).toBeNull();
    expect(await getFormForGroup(t.as(owner), "not-a-uuid")).toBeNull();
    expect(await getFormForGroup(t.as(owner), crypto.randomUUID())).toBeNull();
    const deps = t.as(owner);
    deps.groups = { ...deps.groups, findById: async () => Promise.reject(new Error("db down")) };
    await expect(getFormForGroup(deps, groupId)).rejects.toThrow();
    await t.groups.softDeleteGroup(groupId);
    expect(await getFormForGroup(t.as(owner), groupId)).toBeNull();
  });
});

describe("setFakeGroupFormConfig (the tests' way to give a group its own form)", () => {
  it("changes only that group, reads like the database store does, and refuses an unknown or deleted group", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const one = await t.makeGroup(owner);
    const two = await t.makeGroup(owner);
    expect(setFakeGroupFormConfig(one, CLASS_CONFIG)).toBe(true);
    expect((await t.groups.findById(one))?.formConfig).toEqual(CLASS_CONFIG);
    expect((await t.groups.findById(two))?.formConfig).toEqual(DEFAULT_FORM_CONFIG);
    // Not a valid form (a duplicate id): the default, as a damaged stored value reads.
    const broken = { ...CLASS_CONFIG, types: [CLASS_CONFIG.types[0], CLASS_CONFIG.types[0]] };
    expect(setFakeGroupFormConfig(one, broken)).toBe(true);
    expect((await t.groups.findById(one))?.formConfig).toEqual(DEFAULT_FORM_CONFIG);
    expect(setFakeGroupFormConfig(crypto.randomUUID(), CLASS_CONFIG)).toBe(false);
    await t.groups.softDeleteGroup(two);
    expect(setFakeGroupFormConfig(two, CLASS_CONFIG)).toBe(false);
  });
});

describe("prepareUpload on a group's own form", () => {
  it("stores the answers it checked: the type, the choice id and the text", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await classGroup(t, owner);
    const made = await prepared(
      t.as(owner),
      groupId,
      classUpload({ typeId: "t_lab", details: { f_sem: "o_2", f_subject: "  Organic   Chemistry " } }),
    );
    expect(await t.resources.findById(groupId, made.resourceId)).toMatchObject({
      typeId: "t_lab",
      typeOther: "",
      details: { f_sem: "o_2", f_subject: "Organic Chemistry" },
    });
  });

  it("requires the required detail and, for Other, its text, and reports them with a bad title all together", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await classGroup(t, owner);
    const result = await prepareUpload(t.as(owner), groupId, classUpload({ title: " ", typeId: "other", typeOther: "", details: {} }));
    expect(result).toEqual({
      ok: false,
      fieldErrors: {
        title: FILE_MESSAGES.titleRequired,
        typeOther: FORM_MESSAGES.otherRequired,
        "detail:f_sem": FORM_MESSAGES.chooseOne,
      },
    });
    expect((await t.resources.list(groupId, { limit: 50 })).items).toEqual([]);
    expect(getFakeFileStorageState().grants.size).toBe(0);
  });

  it("accepts Other with its text, trimmed", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await classGroup(t, owner);
    const made = await prepared(t.as(owner), groupId, classUpload({ typeId: "other", typeOther: "  Lab   manual " }));
    expect(await t.resources.findById(groupId, made.resourceId)).toMatchObject({ typeId: "other", typeOther: "Lab manual" });
  });

  it("does not offer what was removed to a new upload: a removed type, a removed choice, a removed detail", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await classGroup(t, owner);
    const deps = t.as(owner);
    expect(await prepareUpload(deps, groupId, classUpload({ typeId: "t_old" }))).toMatchObject({
      ok: false,
      fieldErrors: { type: FORM_MESSAGES.typeRemoved },
    });
    expect(await prepareUpload(deps, groupId, classUpload({ details: { f_sem: "o_3" } }))).toMatchObject({
      ok: false,
      fieldErrors: { "detail:f_sem": FORM_MESSAGES.choiceNotAvailable },
    });
    expect(await prepareUpload(deps, groupId, classUpload({ details: { f_sem: "o_1", f_year: "2024" } }))).toMatchObject({
      ok: false,
      fieldErrors: { "detail:f_year": FORM_MESSAGES.detailRemoved },
    });
    expect((await t.resources.list(groupId, { limit: 50 })).items).toEqual([]);
  });

  it("refuses the default form's types in a group that does not have them, and a choice's label in place of its id", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await classGroup(t, owner);
    const deps = t.as(owner);
    expect(await prepareUpload(deps, groupId, classUpload({ typeId: "notes" }))).toMatchObject({
      ok: false,
      fieldErrors: { type: FORM_MESSAGES.typeNotAvailable },
    });
    expect(await prepareUpload(deps, groupId, classUpload({ details: { f_sem: "Sem 1" } }))).toMatchObject({
      ok: false,
      fieldErrors: { "detail:f_sem": FORM_MESSAGES.choiceNotAvailable },
    });
  });

  it("hostile detail keys never crash it or reach the object's prototype", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await classGroup(t, owner);
    const deps = t.as(owner);
    const hostile = [
      JSON.parse('{"f_sem":"o_1","__proto__":"x"}'),
      JSON.parse('{"f_sem":"o_1","__proto__":{"polluted":"yes"}}'),
      { f_sem: "o_1", constructor: "x", toString: "x", hasOwnProperty: "x" },
      { f_sem: "o_1", ["k".repeat(65)]: "x" },
      { f_sem: ["o_1"] },
      { f_sem: null },
    ];
    for (const sent of hostile) {
      const result = await prepareUpload(deps, groupId, classUpload({ details: sent }));
      expect(typeof result.ok).toBe("boolean");
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    // Not known to the form: refused, with the id as the key (and never a huge key).
    expect(await prepareUpload(deps, groupId, classUpload({ details: { f_sem: "o_1", constructor: "x" } }))).toMatchObject({
      ok: false,
      fieldErrors: { "detail:constructor": FORM_MESSAGES.detailUnknown },
    });
    const longKey = await prepareUpload(deps, groupId, classUpload({ details: { f_sem: "o_1", ["k".repeat(5000)]: "x" } }));
    expect(longKey).toMatchObject({ ok: false });
    expect(JSON.stringify(longKey).length).toBeLessThan(500);
  });

  it("checks against the form the group has when the upload STARTS", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    // The default form has no Semester or lecture notes: refused. After the owner's change: accepted.
    expect(await prepareUpload(t.as(owner), groupId, classUpload())).toMatchObject({ ok: false, fieldErrors: { type: expect.any(String) } });
    setFakeGroupFormConfig(groupId, CLASS_CONFIG);
    expect((await prepareUpload(t.as(owner), groupId, classUpload())).ok).toBe(true);
  });
});

describe("completeUpload and a form that changed", () => {
  it("still succeeds when the owner made a detail required after the upload started, and does not check the answers again", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    const made = await prepared(t.as(owner), groupId, details({ details: {} }));
    expect(sendFile(made.uploadUrl, made.headers, PDF)).toBe(200);
    // The form changes while the file is being sent: Semester is now required, and the type is not on the form.
    setFakeGroupFormConfig(groupId, CLASS_CONFIG);
    const done = await completeUpload(t.as(owner), groupId, made.resourceId);
    expect(done).toMatchObject({
      ok: true,
      data: {
        id: made.resourceId,
        typeId: "notes",
        // The file keeps a type this form does not have; there is no label to show, so it reads as Other.
        typeLabel: "Other",
        typeRemoved: false,
        // Semester is on the form now and the file has no value for it: shown blank.
        details: [
          { fieldId: "f_sem", label: "Semester", display: "", value: "", valueRemoved: false, removed: false },
          { fieldId: "f_subject", label: "Subject", display: "", value: "", valueRemoved: false, removed: false },
        ],
      },
    });
    expect((await t.resources.findById(groupId, made.resourceId))?.status).toBe("ready");
  });

  it("the finished file is editable afterwards: what it already holds passes, empty required details included", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    const made = await prepared(t.as(owner), groupId, details({ details: {} }));
    sendFile(made.uploadUrl, made.headers, PDF);
    setFakeGroupFormConfig(groupId, CLASS_CONFIG);
    await completeUpload(t.as(owner), groupId, made.resourceId);
    // Title only: the type id `notes` is unknown to the form but unchanged; Semester is required but unchanged (empty).
    expect(await updateFile(t.as(owner), groupId, made.resourceId, edited({ title: "Renamed", typeId: "notes" }))).toMatchObject({
      ok: true,
      data: { title: "Renamed", typeId: "notes" },
    });
    // Changing the type to one the form has works; changing it to nonsense does not.
    expect(await updateFile(t.as(owner), groupId, made.resourceId, edited({ typeId: "t_lab" }))).toMatchObject({ ok: true });
    expect(await updateFile(t.as(owner), groupId, made.resourceId, edited({ typeId: "memes" }))).toMatchObject({
      ok: false,
      fieldErrors: { type: FORM_MESSAGES.typeNotAvailable },
    });
  });
});

describe("files whose type or details were removed from the form", () => {
  it("shows a removed type and a removed choice on the file, marked, and keeps showing a removed detail's value", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await classGroup(t, owner);
    const id = await seedReady(t, groupId, owner, {
      typeId: "t_old",
      details: { f_sem: "o_3", f_year: "2019", f_subject: "Physics" },
    });
    const view = await getFile(t.as(owner), groupId, id);
    expect(view).toMatchObject({ typeId: "t_old", typeLabel: "Old exam", typeRemoved: true, typeOther: "" });
    expect(view?.details).toEqual([
      { fieldId: "f_sem", label: "Semester", display: "Semester 3", value: "o_3", valueRemoved: true, removed: false },
      { fieldId: "f_subject", label: "Subject", display: "Physics", value: "Physics", valueRemoved: false, removed: false },
      { fieldId: "f_year", label: "Year", display: "2019", value: "2019", valueRemoved: false, removed: true },
    ]);
    // The list shows the same.
    expect((await listFiles(t.as(owner), groupId))?.items[0]).toEqual(view);
  });

  it("leaves out a removed detail the file has no value for, and reads a choice nobody knows as 'Unknown choice', never its id", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await classGroup(t, owner);
    const id = await seedReady(t, groupId, owner, { details: { f_sem: "o_999" } });
    const view = await getFile(t.as(owner), groupId, id);
    expect(view?.details.map((d) => d.fieldId)).toEqual(["f_sem", "f_subject"]);
    expect(view?.details[0]?.display).toBe("Unknown choice");
    expect(view?.details[0]?.value).toBe("");
    expect(JSON.stringify(view)).not.toContain("o_999");
  });

  it("an old file of type Other with no Other text shows 'Other' and can be edited without adding text", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await t.makeGroup(owner);
    const id = await seedReady(t, groupId, owner, { typeId: "other", typeOther: "", details: { subject: "Maths" } });
    expect(await getFile(t.as(owner), groupId, id)).toMatchObject({ typeId: "other", typeLabel: "Other", typeOther: "", typeRemoved: false });

    const keep = { typeId: "other", typeOther: "", details: { subject: "Maths" } };
    expect(await updateFile(t.as(owner), groupId, id, edited({ title: "New name", ...keep }))).toMatchObject({
      ok: true,
      data: { title: "New name", typeId: "other", typeLabel: "Other", typeOther: "" },
    });
    expect(await t.resources.findById(groupId, id)).toMatchObject({ typeId: "other", typeOther: "", details: { subject: "Maths" } });
    // Whitespace only is the same as no text: still unchanged, still fine.
    expect(await updateFile(t.as(owner), groupId, id, edited({ ...keep, typeOther: "   " }))).toMatchObject({ ok: true });
    // Giving it text works.
    expect(await updateFile(t.as(owner), groupId, id, edited({ ...keep, typeOther: "Lab manual" }))).toMatchObject({
      ok: true,
      data: { typeLabel: "Other: Lab manual", typeOther: "Lab manual" },
    });
    // Moving a different file to Other does need the text.
    const noted = await seedReady(t, groupId, owner, { typeId: "notes" });
    expect(await updateFile(t.as(owner), groupId, noted, edited({ typeId: "other", typeOther: "" }))).toMatchObject({
      ok: false,
      fieldErrors: { typeOther: FORM_MESSAGES.otherRequired },
    });
  });

  it("an edit keeps a removed type, a removed choice and a removed detail's value when they are unchanged", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await classGroup(t, owner);
    const id = await seedReady(t, groupId, owner, { typeId: "t_old", details: { f_sem: "o_3", f_year: "2019" } });
    // The edit form sends what it shows: the type, the choice, and nothing for the detail it no longer has.
    const result = await updateFile(
      t.as(owner),
      groupId,
      id,
      edited({ title: "Better title", typeId: "t_old", details: { f_sem: "o_3", f_subject: "Maths" } }),
    );
    expect(result).toMatchObject({ ok: true, data: { title: "Better title", typeId: "t_old", typeRemoved: true } });
    // The removed detail's value was carried over, not wiped.
    expect(await t.resources.findById(groupId, id)).toMatchObject({
      typeId: "t_old",
      details: { f_sem: "o_3", f_year: "2019", f_subject: "Maths" },
    });
  });

  it("an edit may not newly pick a removed type or choice, or fill a removed detail", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await classGroup(t, owner);
    const id = await seedReady(t, groupId, owner, { typeId: "t_notes", details: { f_sem: "o_1" } });
    const attempt = (change: Record<string, unknown>) =>
      updateFile(t.as(owner), groupId, id, edited({ typeId: "t_notes", details: { f_sem: "o_1" }, ...change }));
    expect(await attempt({ typeId: "t_old" })).toMatchObject({ ok: false, fieldErrors: { type: FORM_MESSAGES.typeRemoved } });
    expect(await attempt({ details: { f_sem: "o_3" } })).toMatchObject({
      ok: false,
      fieldErrors: { "detail:f_sem": FORM_MESSAGES.choiceNotAvailable },
    });
    expect(await attempt({ details: { f_sem: "o_1", f_year: "2024" } })).toMatchObject({
      ok: false,
      fieldErrors: { "detail:f_year": FORM_MESSAGES.detailRemoved },
    });
    expect(await t.resources.findById(groupId, id)).toMatchObject({ typeId: "t_notes", details: { f_sem: "o_1" } });
  });

  it("a required detail an old file never had is not demanded of it, but clearing one it had is refused", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await classGroup(t, owner);
    const bare = await seedReady(t, groupId, owner, { typeId: "t_notes", details: {} });
    expect(await updateFile(t.as(owner), groupId, bare, edited({ title: "Fine", typeId: "t_notes", details: {} }))).toMatchObject({ ok: true });
    const full = await seedReady(t, groupId, owner, { typeId: "t_notes", details: { f_sem: "o_1" } });
    expect(await updateFile(t.as(owner), groupId, full, edited({ typeId: "t_notes", details: {} }))).toMatchObject({
      ok: false,
      fieldErrors: { "detail:f_sem": FORM_MESSAGES.chooseOne },
    });
  });

  it("keeps the title's own rules on an edit and reports a bad title together with a bad answer", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await classGroup(t, owner);
    const id = await seedReady(t, groupId, owner, { details: { f_sem: "o_1" } });
    expect(await updateFile(t.as(owner), groupId, id, edited({ title: "", typeId: "memes", details: { f_sem: "o_1" } }))).toEqual({
      ok: false,
      fieldErrors: { title: FILE_MESSAGES.titleRequired, type: FORM_MESSAGES.typeNotAvailable },
    });
    expect(
      await updateFile(t.as(owner), groupId, id, edited({ title: "x".repeat(121), typeId: "t_notes", details: { f_sem: "o_1" } })),
    ).toMatchObject({ ok: false, fieldErrors: { title: FILE_MESSAGES.titleTooLong } });
  });
});

describe("the library on a group's own form", () => {
  /** Files covering every kind of answer. */
  async function seedLibrary(t: ReturnType<typeof setup>, owner: Person) {
    const groupId = await classGroup(t, owner);
    const files = {
      notes1: await seedReady(t, groupId, owner, { title: "Notes one", typeId: "t_notes", details: { f_sem: "o_1", f_subject: "Maths" } }),
      lab2: await seedReady(t, groupId, owner, { title: "Lab two", typeId: "t_lab", details: { f_sem: "o_2", f_subject: "maths" } }),
      old3: await seedReady(t, groupId, owner, { title: "Old three", typeId: "t_old", details: { f_sem: "o_3", f_year: "2019" } }),
      other: await seedReady(t, groupId, owner, { title: "Misc", typeId: "other", typeOther: "Poster", details: { f_sem: "o_1" } }),
    };
    return { groupId, files };
  }
  const titlesOf = async (t: ReturnType<typeof setup>, who: Person, groupId: string, query: Record<string, unknown> = {}) =>
    ((await listFiles(t.as(who), groupId, query as never))?.items ?? []).map((i) => i.title).sort();

  it("builds the filters from the form and from what files use: removed items appear only while used", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const { groupId } = await seedLibrary(t, owner);
    const list = await listFiles(t.as(owner), groupId);
    expect(list?.filters).toEqual({
      types: [
        { id: "t_notes", label: "Lecture notes", removed: false },
        { id: "t_lab", label: "Lab report", removed: false },
        { id: "t_old", label: "Old exam", removed: true },
        { id: "other", label: "Other", removed: false },
      ],
      fields: [
        {
          id: "f_sem",
          label: "Semester",
          kind: "dropdown",
          removed: false,
          options: [
            { id: "o_1", label: "Sem 1", removed: false },
            { id: "o_2", label: "Sem 2", removed: false },
            { id: "o_3", label: "Semester 3", removed: true },
          ],
        },
        // The distinct values: Maths and maths are one (the spelling that sorts first by bytes).
        { id: "f_subject", label: "Subject", kind: "text", removed: false, options: [{ id: "Maths", label: "Maths", removed: false }] },
        { id: "f_year", label: "Year", kind: "text", removed: true, options: [{ id: "2019", label: "2019", removed: false }] },
      ],
    });
  });

  it("drops a removed type, choice and detail once no file uses them, and keeps active ones that no file uses", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await classGroup(t, owner);
    await seedReady(t, groupId, owner, { typeId: "t_notes", details: { f_sem: "o_1" } });
    const list = await listFiles(t.as(owner), groupId);
    expect(list?.filters.types.map((type) => type.id)).toEqual(["t_notes", "t_lab", "other"]);
    expect(list?.filters.fields.map((field) => field.id)).toEqual(["f_sem", "f_subject"]);
    expect(list?.filters.fields[0]?.options.map((option) => option.id)).toEqual(["o_1", "o_2"]);
    expect(list?.filters.fields[1]?.options).toEqual([]);
    // The default form of a group with no files: its four types and Other, and the empty Subject filter.
    const empty = await listFiles(t.as(owner), await t.makeGroup(owner));
    expect(empty?.filters.types.map((type) => [type.id, type.label])).toEqual([
      ["notes", "Notes"],
      ["pyq", "Previous year paper"],
      ["study_material", "Study material"],
      ["assignment", "Assignment"],
      ["other", "Other"],
    ]);
    expect(empty?.filters.fields).toEqual([{ id: "subject", label: "Subject", kind: "text", removed: false, options: [] }]);
  });

  it("does not count files that are still uploading or deleted when deciding what is used", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const groupId = await classGroup(t, owner);
    const id = await seedReady(t, groupId, owner, { typeId: "t_old", details: { f_sem: "o_3" } });
    await prepared(t.as(owner), groupId, classUpload());
    expect((await listFiles(t.as(owner), groupId))?.filters.types.some((type) => type.id === "t_old")).toBe(true);
    await deleteFile(t.as(owner), groupId, id);
    const after = await listFiles(t.as(owner), groupId);
    expect(after?.filters.types.some((type) => type.id === "t_old")).toBe(false);
    expect(after?.filters.fields[0]?.options.some((option) => option.id === "o_3")).toBe(false);
  });

  it("filters by type (a removed type too), by a dropdown choice id and by a text value, and they combine", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const { groupId } = await seedLibrary(t, owner);
    expect(await titlesOf(t, owner, groupId, { typeId: "t_lab" })).toEqual(["Lab two"]);
    expect(await titlesOf(t, owner, groupId, { typeId: "t_old" })).toEqual(["Old three"]);
    expect(await titlesOf(t, owner, groupId, { typeId: "other" })).toEqual(["Misc"]);
    expect(await titlesOf(t, owner, groupId, { details: { f_sem: "o_1" } })).toEqual(["Misc", "Notes one"]);
    expect(await titlesOf(t, owner, groupId, { details: { f_sem: "o_3" } })).toEqual(["Old three"]);
    expect(await titlesOf(t, owner, groupId, { details: { f_subject: "MATHS" } })).toEqual(["Lab two", "Notes one"]);
    expect(await titlesOf(t, owner, groupId, { details: { f_year: "2019" } })).toEqual(["Old three"]);
    expect(await titlesOf(t, owner, groupId, { typeId: "t_notes", details: { f_sem: "o_1", f_subject: "maths" } })).toEqual(["Notes one"]);
    expect(await titlesOf(t, owner, groupId, { typeId: "t_lab", details: { f_sem: "o_1" } })).toEqual([]);
    // A dropdown is matched by id, never by its label.
    expect(await titlesOf(t, owner, groupId, { details: { f_sem: "Sem 1" } })).toEqual([]);
    expect(await titlesOf(t, owner, groupId, { details: { f_sem: "O_1" } })).toEqual([]);
  });

  it("finds files by the label of their type or choice, the CURRENT label, also after a rename and for removed items", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const { groupId } = await seedLibrary(t, owner);
    expect(await titlesOf(t, owner, groupId, { q: "lab report" })).toEqual(["Lab two"]);
    expect(await titlesOf(t, owner, groupId, { q: "OLD EXAM" })).toEqual(["Old three"]);
    expect(await titlesOf(t, owner, groupId, { q: "semester 3" })).toEqual(["Old three"]);
    expect(await titlesOf(t, owner, groupId, { q: "sem 2" })).toEqual(["Lab two"]);
    expect(await titlesOf(t, owner, groupId, { q: "semester 2" })).toEqual([]);

    // The owner renames "Sem 2" to "Semester 2": the same file is found by the new name, no longer by the old one.
    const renamed: FormConfig = {
      ...CLASS_CONFIG,
      version: 2,
      fields: CLASS_CONFIG.fields.map((field) =>
        field.id === "f_sem"
          ? { ...field, options: field.options?.map((option) => (option.id === "o_2" ? { ...option, label: "Semester 2" } : option)) }
          : field,
      ),
    };
    setFakeGroupFormConfig(groupId, renamed);
    expect(await titlesOf(t, owner, groupId, { q: "semester 2" })).toEqual(["Lab two"]);
    expect(await titlesOf(t, owner, groupId, { q: "Sem 2" })).toEqual([]);
    // The filter shows the new label for the same id.
    const options = (await listFiles(t.as(owner), groupId))?.filters.fields[0]?.options;
    expect(options?.find((option) => option.id === "o_2")?.label).toBe("Semester 2");
  });

  it("searches the Other text and the text details (a removed one too), but not a dropdown's stored id", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const { groupId } = await seedLibrary(t, owner);
    expect(await titlesOf(t, owner, groupId, { q: "poster" })).toEqual(["Misc"]);
    expect(await titlesOf(t, owner, groupId, { q: "maths" })).toEqual(["Lab two", "Notes one"]);
    expect(await titlesOf(t, owner, groupId, { q: "o_1" })).toEqual([]);
    // A removed text detail is still searched, as its filter still works.
    expect(await titlesOf(t, owner, groupId, { q: "2019" })).toEqual(["Old three"]);
  });

  it("an odd address on a custom form never crashes or leaks: unknown types and details, odd ids", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const { groupId } = await seedLibrary(t, owner);
    expect(await titlesOf(t, owner, groupId, { typeId: "notes" })).toEqual([]); // the DEFAULT form's id, not this form's
    expect(await titlesOf(t, owner, groupId, { typeId: "t_notes", details: { zzz: "x" } })).toEqual(["Notes one"]);
    expect(await titlesOf(t, owner, groupId, { details: { f_sem: "o_1", f_subject: "x".repeat(1000) } })).toEqual([]);
    expect(await titlesOf(t, owner, groupId, { details: JSON.parse('{"__proto__":"x","constructor":"x"}') })).toHaveLength(4);
    expect((await listFiles(t.as(owner), groupId, { typeId: "x".repeat(5000) }))?.items).toEqual([]);
  });

  it("never lets one group's form or files show in another group, whatever address is used", async () => {
    const t = setup();
    const owner = t.person("Asha");
    const { groupId, files } = await seedLibrary(t, owner);
    const other = await t.makeGroup(owner); // the same person owns a second group on the default form
    await seedReady(t, other, owner, { title: "Plain", typeId: "notes", details: { subject: "Maths" } });
    const list = await listFiles(t.as(owner), other, { typeId: "t_lab", details: { f_sem: "o_2" }, q: "lab" });
    expect(list?.items).toEqual([]);
    const plain = await listFiles(t.as(owner), other);
    expect(plain?.items.map((item) => item.title)).toEqual(["Plain"]);
    expect(JSON.stringify(plain)).not.toMatch(/Sem 1|Lab report|Old exam|Semester|t_lab|o_1/);
    // The other group's file ids are not found under this group's address either.
    expect(await getFile(t.as(owner), other, files.notes1)).toBeNull();
    expect(await openFile(t.as(owner), other, files.notes1, { download: true })).toBeNull();
    expect(await updateFile(t.as(owner), other, files.notes1, edited({ typeId: "notes" }))).toEqual({
      ok: false,
      notFound: true,
      formError: FILE_MESSAGES.notFound,
    });
    expect(await getFile(t.as(owner), groupId, files.notes1)).toMatchObject({ title: "Notes one" });
  });
});
