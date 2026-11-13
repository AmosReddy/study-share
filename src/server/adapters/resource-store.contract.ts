import { describe, expect, test } from "vitest";
import { RESOURCE_LIMITS, type ResourceType } from "@/shared/resources";
import type { NewResource, ResourceRecord, ResourceStore } from "../ports/resource-store";

export type ResourceStoreContext = {
  store: ResourceStore;
  /** A new person, as an account would be; the name is what a file's uploaderName shows. */
  newUser(name?: string): Promise<string>;
  /** A new group owned by that person; returns its id. */
  newGroup(ownerId: string): Promise<string>;
  /** Soft-deletes the group, as the group store does. */
  deleteGroup(groupId: string): Promise<void>;
  /** Removes the person's account, as deleting a user does (the database clears uploader_id). */
  deleteUser(userId: string): Promise<void>;
};

type WithStore = (run: (ctx: ResourceStoreContext) => Promise<void>) => Promise<void>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Long enough that two files never share a creation millisecond, so the newest-first order is certain. */
const TICK_MS = 5;

/**
 * Behaviour every ResourceStore must have. `withStore` sets up a clean store, runs the test body
 * with it, and cleans up, so each implementation keeps its own set-up and clean-up.
 * Calling this registers tests, so call it only from a test file.
 */
export function runResourceStoreContract(withStore: WithStore): void {
  /** Random file id and key, so a rerun or another worker on the same database never collides. */
  function fileInput(groupId: string, uploaderId: string, over: Partial<NewResource> = {}): NewResource {
    const id = crypto.randomUUID();
    return {
      id,
      groupId,
      uploaderId,
      title: "Cell biology notes",
      subject: "Biology",
      type: "notes",
      fileKey: `groups/${groupId}/${id}/notes.pdf`,
      fileName: "notes.pdf",
      contentType: "application/pdf",
      sizeBytes: 1234,
      ...over,
    };
  }

  /** A file left 'uploading', created a moment after the previous one. */
  async function pending(ctx: ResourceStoreContext, groupId: string, uploaderId: string, over: Partial<NewResource> = {}) {
    await sleep(TICK_MS);
    return ctx.store.createPending(fileInput(groupId, uploaderId, over));
  }

  /** A file that is ready. */
  async function ready(ctx: ResourceStoreContext, groupId: string, uploaderId: string, over: Partial<NewResource> = {}) {
    const record = await pending(ctx, groupId, uploaderId, over);
    const done = await ctx.store.markReady(record.id, groupId);
    if (!done) throw new Error("markReady failed");
    return done;
  }

  async function setup(ctx: ResourceStoreContext) {
    const uploader = await ctx.newUser("Ada");
    const groupId = await ctx.newGroup(uploader);
    return { uploader, groupId };
  }

  const ids = (records: ResourceRecord[]) => records.map((r) => r.id);
  const titles = (records: ResourceRecord[]) => records.map((r) => r.title);

  /** Every page of a list, following the cursor. */
  async function allPages(store: ResourceStore, groupId: string, query: Omit<Parameters<ResourceStore["list"]>[1], "cursor">) {
    const pages: ResourceRecord[][] = [];
    let cursor: string | undefined;
    for (let n = 0; n < 50; n++) {
      const page = await store.list(groupId, { ...query, cursor });
      pages.push(page.items);
      if (page.nextCursor === null) return pages;
      cursor = page.nextCursor;
    }
    throw new Error("the list never ended");
  }

  describe("ResourceStore contract", () => {
    test("createPending makes an uploading file with the uploader's name", () =>
      withStore(async (ctx) => {
        const { uploader, groupId } = await setup(ctx);
        const input = fileInput(groupId, uploader, { title: "Week 3", subject: "Physics", type: "pyq", sizeBytes: 99 });
        const record = await ctx.store.createPending(input);
        expect(record).toMatchObject({
          id: input.id,
          groupId,
          uploaderId: uploader,
          uploaderName: "Ada",
          title: "Week 3",
          subject: "Physics",
          type: "pyq",
          fileKey: input.fileKey,
          fileName: "notes.pdf",
          contentType: "application/pdf",
          sizeBytes: 99,
          status: "uploading",
        });
        expect(Math.abs(record.createdAt.getTime() - Date.now())).toBeLessThan(600_000);
        expect(await ctx.store.findById(groupId, input.id)).toEqual(record);
      }));

    test("an uploading file is found by id but is not listed, and its subject is not offered", () =>
      withStore(async (ctx) => {
        const { uploader, groupId } = await setup(ctx);
        const record = await pending(ctx, groupId, uploader);
        expect((await ctx.store.findById(groupId, record.id))?.status).toBe("uploading");
        expect(await ctx.store.list(groupId, { limit: 10 })).toEqual({ items: [], nextCursor: null });
        expect(await ctx.store.listSubjects(groupId)).toEqual([]);
      }));

    test("markReady shows the file in the list, and a repeat returns it again", () =>
      withStore(async (ctx) => {
        const { uploader, groupId } = await setup(ctx);
        const record = await pending(ctx, groupId, uploader);
        const done = await ctx.store.markReady(record.id, groupId);
        expect(done).toEqual({ ...record, status: "ready" });
        expect(await ctx.store.markReady(record.id, groupId)).toEqual(done);
        expect(await ctx.store.findById(groupId, record.id)).toEqual(done);
        expect((await ctx.store.list(groupId, { limit: 10 })).items).toEqual([done]);
        expect(await ctx.store.listSubjects(groupId)).toEqual(["Biology"]);
      }));

    test("markReady finds nothing for an unknown file, another group's file, or a deleted file", () =>
      withStore(async (ctx) => {
        const { uploader, groupId } = await setup(ctx);
        const otherGroup = await ctx.newGroup(uploader);
        const record = await pending(ctx, groupId, uploader);
        expect(await ctx.store.markReady(crypto.randomUUID(), groupId)).toBeNull();
        expect(await ctx.store.markReady(record.id, otherGroup)).toBeNull();
        expect((await ctx.store.findById(groupId, record.id))?.status).toBe("uploading");

        expect(await ctx.store.softDelete(groupId, record.id)).not.toBeNull();
        expect(await ctx.store.markReady(record.id, groupId)).toBeNull();
        // A deleted file that was ready is not brought back by a repeat either.
        const second = await ready(ctx, groupId, uploader);
        await ctx.store.softDelete(groupId, second.id);
        expect(await ctx.store.markReady(second.id, groupId)).toBeNull();
      }));

    test("lists newest first and pages with a cursor, with no file missed or repeated", () =>
      withStore(async (ctx) => {
        const { uploader, groupId } = await setup(ctx);
        const made: ResourceRecord[] = [];
        for (let n = 1; n <= 5; n++) made.push(await ready(ctx, groupId, uploader, { title: `File ${n}` }));
        const newestFirst = [...made].reverse();

        const first = await ctx.store.list(groupId, { limit: 2 });
        expect(ids(first.items)).toEqual(ids(newestFirst.slice(0, 2)));
        expect(typeof first.nextCursor).toBe("string");

        const pages = await allPages(ctx.store, groupId, { limit: 2 });
        expect(pages.map((p) => p.length)).toEqual([2, 2, 1]);
        expect(ids(pages.flat())).toEqual(ids(newestFirst));

        // A page that ends exactly at the last file has no next page.
        const exact = await allPages(ctx.store, groupId, { limit: 5 });
        expect(exact.map((p) => p.length)).toEqual([5]);
        expect((await ctx.store.list(groupId, { limit: 5 })).nextCursor).toBeNull();
      }));

    test("a file added or removed between pages does not disturb the pages after it", () =>
      withStore(async (ctx) => {
        const { uploader, groupId } = await setup(ctx);
        const made: ResourceRecord[] = [];
        for (let n = 1; n <= 4; n++) made.push(await ready(ctx, groupId, uploader, { title: `File ${n}` }));
        const first = await ctx.store.list(groupId, { limit: 2 });
        expect(titles(first.items)).toEqual(["File 4", "File 3"]);
        await ready(ctx, groupId, uploader, { title: "File 5" });
        await ctx.store.softDelete(groupId, made[2].id);
        const next = await ctx.store.list(groupId, { limit: 2, cursor: first.nextCursor ?? undefined });
        expect(titles(next.items)).toEqual(["File 2", "File 1"]);
        expect(next.nextCursor).toBeNull();
      }));

    test("the page size is kept between 1 and 50, and a cursor that is not one starts at the top", () =>
      withStore(async (ctx) => {
        const { uploader, groupId } = await setup(ctx);
        for (let n = 1; n <= 3; n++) await ready(ctx, groupId, uploader, { title: `File ${n}` });
        expect((await ctx.store.list(groupId, { limit: 0 })).items).toHaveLength(1);
        expect((await ctx.store.list(groupId, { limit: -5 })).items).toHaveLength(1);
        expect((await ctx.store.list(groupId, { limit: 2.9 })).items).toHaveLength(2);
        expect((await ctx.store.list(groupId, { limit: 1000 })).items).toHaveLength(3);
        for (const cursor of ["", "garbage", "!!!", "AAAA", "x".repeat(500)]) {
          expect(titles((await ctx.store.list(groupId, { limit: 10, cursor })).items)).toEqual(["File 3", "File 2", "File 1"]);
        }
      }));

    test("pages through more files than the largest page", () =>
      withStore(async (ctx) => {
        const { uploader, groupId } = await setup(ctx);
        // Pending files are created in one go (no wait), then made ready: the order by time and id
        // is still total, so the paging must still return each file exactly once.
        const made: ResourceRecord[] = [];
        for (let n = 0; n < 53; n++) made.push(await ctx.store.createPending(fileInput(groupId, uploader, { title: `Bulk ${n}` })));
        for (const r of made) await ctx.store.markReady(r.id, groupId);
        const pages = await allPages(ctx.store, groupId, { limit: 1000 });
        expect(pages.map((p) => p.length)).toEqual([50, 3]);
        expect(new Set(ids(pages.flat())).size).toBe(53);
        expect([...ids(pages.flat())].sort()).toEqual([...ids(made)].sort());
      }));

    test("filters by type and by subject (any letter case), and the filters combine", () =>
      withStore(async (ctx) => {
        const { uploader, groupId } = await setup(ctx);
        await ready(ctx, groupId, uploader, { title: "A", type: "notes", subject: "Maths" });
        await ready(ctx, groupId, uploader, { title: "B", type: "pyq", subject: "maths" });
        await ready(ctx, groupId, uploader, { title: "C", type: "pyq", subject: "Physics" });
        await ready(ctx, groupId, uploader, { title: "D", type: "other", subject: "" });
        const list = async (query: Partial<Parameters<ResourceStore["list"]>[1]>) =>
          titles((await ctx.store.list(groupId, { limit: 10, ...query })).items);

        expect(await list({ type: "pyq" })).toEqual(["C", "B"]);
        expect(await list({ type: "assignment" })).toEqual([]);
        expect(await list({ subject: "MATHS" })).toEqual(["B", "A"]);
        expect(await list({ subject: "Physic" })).toEqual([]);
        expect(await list({ subject: "" })).toEqual(["D"]);
        expect(await list({ type: "pyq", subject: "maths" })).toEqual(["B"]);
        expect(await list({ type: "notes", subject: "Physics" })).toEqual([]);
        expect(await list({ type: "pyq", subject: "Physics", search: "c" })).toEqual(["C"]);
      }));

    test("filters keep their meaning across pages", () =>
      withStore(async (ctx) => {
        const { uploader, groupId } = await setup(ctx);
        for (let n = 1; n <= 5; n++) {
          await ready(ctx, groupId, uploader, { title: `Chem ${n}`, type: "notes", subject: "Chemistry" });
          await ready(ctx, groupId, uploader, { title: `Hist ${n}`, type: "pyq", subject: "History" });
        }
        const pages = await allPages(ctx.store, groupId, { limit: 2, type: "notes", subject: "chemistry", search: "chem" });
        expect(titles(pages.flat())).toEqual(["Chem 5", "Chem 4", "Chem 3", "Chem 2", "Chem 1"]);
        expect(pages.map((p) => p.length)).toEqual([2, 2, 1]);
      }));

    test("searches title, subject and file name, ignoring letter case", () =>
      withStore(async (ctx) => {
        const { uploader, groupId } = await setup(ctx);
        await ready(ctx, groupId, uploader, { title: "Organic Chemistry", subject: "Science", fileName: "a.pdf" });
        await ready(ctx, groupId, uploader, { title: "Week 1", subject: "Thermodynamics", fileName: "b.pdf" });
        await ready(ctx, groupId, uploader, { title: "Week 2", subject: "Art", fileName: "Lecture-Scan.PNG" });
        const find = async (search: string) => titles((await ctx.store.list(groupId, { limit: 10, search })).items);

        expect(await find("chemistry")).toEqual(["Organic Chemistry"]);
        expect(await find("THERMO")).toEqual(["Week 1"]);
        expect(await find("lecture-scan")).toEqual(["Week 2"]);
        expect(await find("week")).toEqual(["Week 2", "Week 1"]);
        expect(await find("organic chemistry")).toEqual(["Organic Chemistry"]);
        expect(await find("  chemistry  ")).toEqual(["Organic Chemistry"]);
        expect(await find("nothing like this")).toEqual([]);
        // A blank search is no search.
        expect(await find("")).toHaveLength(3);
        expect(await find("   ")).toHaveLength(3);
      }));

    test("percent, underscore and backslash in a search are ordinary characters", () =>
      withStore(async (ctx) => {
        const { uploader, groupId } = await setup(ctx);
        await ready(ctx, groupId, uploader, { title: "100% sure", subject: "", fileName: "one.pdf" });
        await ready(ctx, groupId, uploader, { title: "1000 sure", subject: "", fileName: "two.pdf" });
        await ready(ctx, groupId, uploader, { title: "snake_case", subject: "", fileName: "three.pdf" });
        await ready(ctx, groupId, uploader, { title: "snakeXcase", subject: "", fileName: "four.pdf" });
        await ready(ctx, groupId, uploader, { title: "C:\\temp", subject: "", fileName: "five.pdf" });
        await ready(ctx, groupId, uploader, { title: "C:Xtemp", subject: "", fileName: "six.pdf" });
        await ready(ctx, groupId, uploader, { title: "plain", subject: "", fileName: "my_file%1.pdf" });
        const find = async (search: string) => titles((await ctx.store.list(groupId, { limit: 10, search })).items);

        expect(await find("100%")).toEqual(["100% sure"]);
        expect(await find("%")).toEqual(["plain", "100% sure"]);
        expect(await find("_")).toEqual(["plain", "snake_case"]);
        expect(await find("e_c")).toEqual(["snake_case"]);
        expect(await find("\\")).toEqual(["C:\\temp"]);
        expect(await find("C:\\t")).toEqual(["C:\\temp"]);
        expect(await find("\\%")).toEqual([]);
        expect(await find("my_file%1")).toEqual(["plain"]);
      }));

    test("lists each subject once, without the empty one, ordered by bytes, from ready files only", () =>
      withStore(async (ctx) => {
        const { uploader, groupId } = await setup(ctx);
        await ready(ctx, groupId, uploader, { subject: "maths" });
        await ready(ctx, groupId, uploader, { subject: "Maths" });
        await ready(ctx, groupId, uploader, { subject: "Zoology" });
        await ready(ctx, groupId, uploader, { subject: "biology" });
        await ready(ctx, groupId, uploader, { subject: "biology" });
        await ready(ctx, groupId, uploader, { subject: "" });
        await pending(ctx, groupId, uploader, { subject: "Pending only" });
        const gone = await ready(ctx, groupId, uploader, { subject: "Deleted only" });
        await ctx.store.softDelete(groupId, gone.id);

        // "Maths" and "maths" are one subject (the filter ignores case); the one kept is the
        // first by bytes, a capital before a small letter.
        expect(await ctx.store.listSubjects(groupId)).toEqual(["biology", "Maths", "Zoology"]);
      }));

    test("subjects and lists are per group", () =>
      withStore(async (ctx) => {
        const { uploader, groupId } = await setup(ctx);
        const other = await ctx.newGroup(uploader);
        await ready(ctx, groupId, uploader, { title: "Mine", subject: "Art" });
        await ready(ctx, other, uploader, { title: "Theirs", subject: "Music" });
        expect(await ctx.store.listSubjects(groupId)).toEqual(["Art"]);
        expect(await ctx.store.listSubjects(other)).toEqual(["Music"]);
        expect(titles((await ctx.store.list(groupId, { limit: 10 })).items)).toEqual(["Mine"]);
        expect(titles((await ctx.store.list(other, { limit: 10 })).items)).toEqual(["Theirs"]);
      }));

    test("a file is only found through its own group", () =>
      withStore(async (ctx) => {
        const { uploader, groupId } = await setup(ctx);
        const other = await ctx.newGroup(uploader);
        const record = await ready(ctx, groupId, uploader);
        expect(await ctx.store.findById(other, record.id)).toBeNull();
        expect(await ctx.store.update(other, record.id, { title: "Hijack", subject: "", type: "other" })).toBeNull();
        expect(await ctx.store.softDelete(other, record.id)).toBeNull();
        expect(await ctx.store.findById(groupId, record.id)).toEqual(record);
      }));

    test("update changes title, subject and type, also while the file is uploading", () =>
      withStore(async (ctx) => {
        const { uploader, groupId } = await setup(ctx);
        const wait = await pending(ctx, groupId, uploader);
        const early = await ctx.store.update(groupId, wait.id, { title: "Early", subject: "", type: "other" });
        expect(early).toMatchObject({ id: wait.id, title: "Early", subject: "", type: "other", status: "uploading" });

        const record = await ready(ctx, groupId, uploader, { title: "Old", subject: "Old subject", type: "notes" });
        const updated = await ctx.store.update(groupId, record.id, { title: "New", subject: "New subject", type: "assignment" });
        expect(updated).toEqual({ ...record, title: "New", subject: "New subject", type: "assignment" });
        expect(await ctx.store.findById(groupId, record.id)).toEqual(updated);
        expect((await ctx.store.list(groupId, { limit: 10, type: "assignment" })).items).toEqual([updated]);
        expect(await ctx.store.listSubjects(groupId)).toEqual(["New subject"]);
      }));

    test("update finds nothing for an unknown or deleted file", () =>
      withStore(async (ctx) => {
        const { uploader, groupId } = await setup(ctx);
        const record = await ready(ctx, groupId, uploader);
        const d = { title: "X", subject: "", type: "notes" as ResourceType };
        expect(await ctx.store.update(groupId, crypto.randomUUID(), d)).toBeNull();
        await ctx.store.softDelete(groupId, record.id);
        expect(await ctx.store.update(groupId, record.id, d)).toBeNull();
      }));

    test("softDelete returns the file, hides it everywhere, and works once", () =>
      withStore(async (ctx) => {
        const { uploader, groupId } = await setup(ctx);
        const keep = await ready(ctx, groupId, uploader, { title: "Keep", subject: "Art" });
        const record = await ready(ctx, groupId, uploader, { title: "Remove", subject: "Music" });
        const removed = await ctx.store.softDelete(groupId, record.id);
        expect(removed).toEqual(record);
        expect(removed?.fileKey).toBe(record.fileKey);

        expect(await ctx.store.findById(groupId, record.id)).toBeNull();
        expect(await ctx.store.list(groupId, { limit: 10 })).toEqual({ items: [keep], nextCursor: null });
        expect(await ctx.store.list(groupId, { limit: 10, search: "remove" })).toEqual({ items: [], nextCursor: null });
        expect(await ctx.store.listSubjects(groupId)).toEqual(["Art"]);
        expect(await ctx.store.softDelete(groupId, record.id)).toBeNull();
        expect(await ctx.store.softDelete(groupId, crypto.randomUUID())).toBeNull();
      }));

    test("an uploading file can be deleted too", () =>
      withStore(async (ctx) => {
        const { uploader, groupId } = await setup(ctx);
        const record = await pending(ctx, groupId, uploader);
        expect(await ctx.store.softDelete(groupId, record.id)).toEqual(record);
        expect(await ctx.store.findById(groupId, record.id)).toBeNull();
      }));

    test("a deleted file's key stays taken", () =>
      withStore(async (ctx) => {
        const { uploader, groupId } = await setup(ctx);
        const record = await ready(ctx, groupId, uploader);
        await ctx.store.softDelete(groupId, record.id);
        await expect(ctx.store.createPending(fileInput(groupId, uploader, { fileKey: record.fileKey }))).rejects.toThrow();
      }));

    test("a deleted group's files are gone from every method", () =>
      withStore(async (ctx) => {
        const { uploader, groupId } = await setup(ctx);
        const done = await ready(ctx, groupId, uploader);
        const waiting = await pending(ctx, groupId, uploader);
        await ctx.deleteGroup(groupId);

        expect(await ctx.store.findById(groupId, done.id)).toBeNull();
        expect(await ctx.store.findById(groupId, waiting.id)).toBeNull();
        expect(await ctx.store.list(groupId, { limit: 10 })).toEqual({ items: [], nextCursor: null });
        expect(await ctx.store.listSubjects(groupId)).toEqual([]);
        expect(await ctx.store.markReady(waiting.id, groupId)).toBeNull();
        expect(await ctx.store.update(groupId, done.id, { title: "X", subject: "", type: "notes" })).toBeNull();
        expect(await ctx.store.softDelete(groupId, done.id)).toBeNull();
        await expect(ctx.store.createPending(fileInput(groupId, uploader))).rejects.toThrow();
      }));

    test("createPending fails for a group that does not exist or an uploader who has no account", () =>
      withStore(async (ctx) => {
        const { uploader, groupId } = await setup(ctx);
        await expect(ctx.store.createPending(fileInput(crypto.randomUUID(), uploader))).rejects.toThrow();
        await expect(ctx.store.createPending(fileInput(groupId, crypto.randomUUID()))).rejects.toThrow();
        expect(await ctx.store.list(groupId, { limit: 10 })).toEqual({ items: [], nextCursor: null });
      }));

    test("createPending fails for a taken id or file key, and writes nothing", () =>
      withStore(async (ctx) => {
        const { uploader, groupId } = await setup(ctx);
        const first = await ready(ctx, groupId, uploader, { title: "First" });
        await expect(ctx.store.createPending(fileInput(groupId, uploader, { id: first.id }))).rejects.toThrow();
        await expect(ctx.store.createPending(fileInput(groupId, uploader, { fileKey: first.fileKey }))).rejects.toThrow();
        expect(titles((await ctx.store.list(groupId, { limit: 10 })).items)).toEqual(["First"]);
        expect(await ctx.store.findById(groupId, first.id)).toEqual(first);
      }));

    test("createPending refuses values outside the limits and accepts the edges", () =>
      withStore(async (ctx) => {
        const { uploader, groupId } = await setup(ctx);
        const refused: Partial<NewResource>[] = [
          { title: "" },
          { title: "   " },
          { title: "x".repeat(RESOURCE_LIMITS.maxTitle + 1) },
          { subject: "x".repeat(RESOURCE_LIMITS.maxSubject + 1) },
          { fileName: "" },
          { fileName: "x".repeat(RESOURCE_LIMITS.maxFileName + 1) },
          { type: "video" as ResourceType },
          { sizeBytes: 0 },
          { sizeBytes: -1 },
        ];
        for (const over of refused) {
          await expect(ctx.store.createPending(fileInput(groupId, uploader, over)), JSON.stringify(over).slice(0, 60)).rejects.toThrow();
        }
        expect(await ctx.store.list(groupId, { limit: 10 })).toEqual({ items: [], nextCursor: null });

        const edge = await ctx.store.createPending(
          fileInput(groupId, uploader, {
            title: "x".repeat(RESOURCE_LIMITS.maxTitle),
            subject: "y".repeat(RESOURCE_LIMITS.maxSubject),
            fileName: "z".repeat(RESOURCE_LIMITS.maxFileName),
            sizeBytes: RESOURCE_LIMITS.maxFileBytes,
          }),
        );
        expect(edge.sizeBytes).toBe(RESOURCE_LIMITS.maxFileBytes);
        // Characters people see are counted, so 120 emoji fit and are not 240.
        await ctx.store.createPending(fileInput(groupId, uploader, { title: "😀".repeat(RESOURCE_LIMITS.maxTitle) }));
        // The empty subject is the default.
        await ctx.store.createPending(fileInput(groupId, uploader, { subject: "" }));
      }));

    test("update refuses values outside the limits and changes nothing", () =>
      withStore(async (ctx) => {
        const { uploader, groupId } = await setup(ctx);
        const record = await ready(ctx, groupId, uploader);
        const refused = [
          { title: "", subject: "", type: "notes" as ResourceType },
          { title: "   ", subject: "", type: "notes" as ResourceType },
          { title: "x".repeat(RESOURCE_LIMITS.maxTitle + 1), subject: "", type: "notes" as ResourceType },
          { title: "T", subject: "x".repeat(RESOURCE_LIMITS.maxSubject + 1), type: "notes" as ResourceType },
          { title: "T", subject: "", type: "video" as ResourceType },
        ];
        for (const d of refused) await expect(ctx.store.update(groupId, record.id, d)).rejects.toThrow();
        expect(await ctx.store.findById(groupId, record.id)).toEqual(record);
      }));

    test("a file whose uploader's account is gone stays, with no uploader and an empty name", () =>
      withStore(async (ctx) => {
        const owner = await ctx.newUser("Owner");
        const groupId = await ctx.newGroup(owner);
        const leaver = await ctx.newUser("Leaver");
        const record = await ready(ctx, groupId, leaver, { title: "Left behind" });
        const waiting = await pending(ctx, groupId, leaver, { title: "Still uploading" });
        expect((await ctx.store.findById(groupId, record.id))?.uploaderName).toBe("Leaver");

        await ctx.deleteUser(leaver);

        const found = await ctx.store.findById(groupId, record.id);
        expect(found).toEqual({ ...record, uploaderId: null, uploaderName: "" });
        expect((await ctx.store.list(groupId, { limit: 10 })).items).toEqual([{ ...record, uploaderId: null, uploaderName: "" }]);
        expect((await ctx.store.findById(groupId, waiting.id))?.uploaderId).toBeNull();
        expect((await ctx.store.markReady(waiting.id, groupId))?.uploaderName).toBe("");
        expect((await ctx.store.update(groupId, record.id, { title: "Renamed", subject: "", type: "notes" }))?.uploaderId).toBeNull();
        expect((await ctx.store.softDelete(groupId, record.id))?.uploaderName).toBe("");
      }));

    test("names come from each file's own uploader", () =>
      withStore(async (ctx) => {
        const ada = await ctx.newUser("Ada");
        const grace = await ctx.newUser("Grace");
        const groupId = await ctx.newGroup(ada);
        await ready(ctx, groupId, ada, { title: "By Ada" });
        await ready(ctx, groupId, grace, { title: "By Grace" });
        const items = (await ctx.store.list(groupId, { limit: 10 })).items;
        expect(items.map((r) => [r.title, r.uploaderName])).toEqual([
          ["By Grace", "Grace"],
          ["By Ada", "Ada"],
        ]);
      }));

    test("ids that are not uuids name nothing instead of failing", () =>
      withStore(async (ctx) => {
        const { uploader, groupId } = await setup(ctx);
        const record = await ready(ctx, groupId, uploader);
        for (const bad of ["not-a-uuid", "", "12345", "00000000-0000-0000-0000-00000000000g"]) {
          expect(await ctx.store.findById(groupId, bad)).toBeNull();
          expect(await ctx.store.findById(bad, record.id)).toBeNull();
          expect(await ctx.store.markReady(bad, groupId)).toBeNull();
          expect(await ctx.store.markReady(record.id, bad)).toBeNull();
          expect(await ctx.store.list(bad, { limit: 10 })).toEqual({ items: [], nextCursor: null });
          expect(await ctx.store.listSubjects(bad)).toEqual([]);
          expect(await ctx.store.update(bad, record.id, { title: "X", subject: "", type: "notes" })).toBeNull();
          expect(await ctx.store.update(groupId, bad, { title: "X", subject: "", type: "notes" })).toBeNull();
          expect(await ctx.store.softDelete(bad, record.id)).toBeNull();
          expect(await ctx.store.softDelete(groupId, bad)).toBeNull();
        }
        await expect(ctx.store.createPending(fileInput("not-a-uuid", uploader))).rejects.toThrow();
        await expect(ctx.store.createPending(fileInput(groupId, "not-a-uuid"))).rejects.toThrow();
        await expect(ctx.store.createPending(fileInput(groupId, uploader, { id: "not-a-uuid" }))).rejects.toThrow();
        expect(await ctx.store.findById(groupId, record.id)).toEqual(record);
      }));

    test("ids in capital letters name the same file", () =>
      withStore(async (ctx) => {
        const { uploader, groupId } = await setup(ctx);
        const record = await ready(ctx, groupId, uploader);
        expect(await ctx.store.findById(groupId.toUpperCase(), record.id.toUpperCase())).toEqual(record);
        expect((await ctx.store.list(groupId.toUpperCase(), { limit: 10 })).items).toEqual([record]);
      }));

    test("text that cannot be stored matches nothing instead of failing", () =>
      withStore(async (ctx) => {
        const { uploader, groupId } = await setup(ctx);
        await ready(ctx, groupId, uploader);
        expect(await ctx.store.list(groupId, { limit: 10, search: "a\u0000b" })).toEqual({ items: [], nextCursor: null });
        expect(await ctx.store.list(groupId, { limit: 10, subject: "a\u0000b" })).toEqual({ items: [], nextCursor: null });
      }));
  });
}
