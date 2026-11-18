import { describe, expect, test } from "vitest";
import { RESOURCE_LIMITS } from "@/shared/resources";
import type { DetailFilter, NewResource, ResourceRecord, ResourceSearch, ResourceStore } from "../ports/resource-store";

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
      typeId: "notes",
      typeOther: "",
      details: { subject: "Biology" },
      fileKey: `groups/${groupId}/${id}/notes.pdf`,
      fileName: "notes.pdf",
      contentType: "application/pdf",
      sizeBytes: 1234,
      ...over,
    };
  }

  /** Every detail id these tests use, for usedOptionIds. */
  const ALL = ["semester", "year", "subject", "extra"];

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

  /** A search as the use-cases build it: the text is looked for in the Subject detail's answers too. */
  const searchFor = (text: string, over: Partial<ResourceSearch> = {}): ResourceSearch => ({
    text,
    typeIds: [],
    optionIds: [],
    textFieldIds: ["subject"],
    ...over,
  });
  const textFilter = (fieldId: string, value: string): DetailFilter => ({ fieldId, kind: "text", value });
  const choiceFilter = (fieldId: string, value: string): DetailFilter => ({ fieldId, kind: "dropdown", value });
  const none = { items: [], nextCursor: null };
  /** The answers the tests give for update. */
  const answers = (over: Partial<{ title: string; typeId: string; typeOther: string; details: Record<string, string> }> = {}) => ({
    title: "X",
    typeId: "notes",
    typeOther: "",
    details: {},
    ...over,
  });

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

  const listTitles = async (ctx: ResourceStoreContext, groupId: string, query: Partial<Parameters<ResourceStore["list"]>[1]>) =>
    titles((await ctx.store.list(groupId, { limit: 10, ...query })).items);

  describe("ResourceStore contract", () => {
    test("createPending makes an uploading file with the uploader's name and its answers", () =>
      withStore(async (ctx) => {
        const { uploader, groupId } = await setup(ctx);
        const input = fileInput(groupId, uploader, {
          title: "Week 3",
          typeId: "pyq",
          details: { subject: "Physics", semester: "opt_3" },
          sizeBytes: 99,
        });
        const record = await ctx.store.createPending(input);
        expect(record).toMatchObject({
          id: input.id,
          groupId,
          uploaderId: uploader,
          uploaderName: "Ada",
          title: "Week 3",
          typeId: "pyq",
          typeOther: "",
          details: { subject: "Physics", semester: "opt_3" },
          fileKey: input.fileKey,
          fileName: "notes.pdf",
          contentType: "application/pdf",
          sizeBytes: 99,
          status: "uploading",
        });
        // The old columns are not part of a record any more.
        expect(record).not.toHaveProperty("type");
        expect(record).not.toHaveProperty("subject");
        expect(Math.abs(record.createdAt.getTime() - Date.now())).toBeLessThan(600_000);
        expect(await ctx.store.findById(groupId, input.id)).toEqual(record);
      }));

    test("a file keeps its Other text and ids the store has never heard of, and may have no details", () =>
      withStore(async (ctx) => {
        const { uploader, groupId } = await setup(ctx);
        const other = await ready(ctx, groupId, uploader, { typeId: "other", typeOther: "Lab manual", details: {} });
        expect(other).toMatchObject({ typeId: "other", typeOther: "Lab manual", details: {} });
        // The store does not check answers against the group's form: that is the use-cases' job.
        const custom = await ready(ctx, groupId, uploader, {
          typeId: "k3j9x",
          details: { f8q2: "opt_zz", "with space & symbols": "ünï 😀" },
        });
        expect(custom).toMatchObject({ typeId: "k3j9x", details: { f8q2: "opt_zz", "with space & symbols": "ünï 😀" } });
        expect(await ctx.store.findById(groupId, other.id)).toEqual(other);
        expect(await ctx.store.findById(groupId, custom.id)).toEqual(custom);
      }));

    test("a detail id like __proto__ is plain data, and a record's details are its own copy", () =>
      withStore(async (ctx) => {
        const { uploader, groupId } = await setup(ctx);
        const details = Object.fromEntries([
          ["__proto__", "x"],
          ["constructor", "y"],
        ]);
        const record = await ready(ctx, groupId, uploader, { details });
        const found = await ctx.store.findById(groupId, record.id);
        for (const r of [record, found]) {
          expect(Object.getPrototypeOf(r?.details)).toBe(Object.prototype);
          expect(Object.hasOwn(r?.details ?? {}, "__proto__")).toBe(true);
          expect(Object.entries(r?.details ?? {}).sort()).toEqual([
            ["__proto__", "x"],
            ["constructor", "y"],
          ]);
        }
        // Changing what one call returned changes nothing for the next.
        if (found) found.details.extra = "changed";
        expect(Object.keys((await ctx.store.findById(groupId, record.id))?.details ?? {}).sort()).toEqual(["__proto__", "constructor"]);
      }));

    test("an uploading file is found by id but is not listed, and its answers are not offered", () =>
      withStore(async (ctx) => {
        const { uploader, groupId } = await setup(ctx);
        const record = await pending(ctx, groupId, uploader);
        expect((await ctx.store.findById(groupId, record.id))?.status).toBe("uploading");
        expect(await ctx.store.list(groupId, { limit: 10 })).toEqual(none);
        expect(await ctx.store.listDetailValues(groupId, "subject")).toEqual([]);
        expect(await ctx.store.usedOptionIds(groupId, ["subject", "semester"])).toEqual({ typeIds: [], detailValues: {} });
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
        expect(await ctx.store.listDetailValues(groupId, "subject")).toEqual(["Biology"]);
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

    test("filters by type id and by a text detail (any letter case), and the filters combine", () =>
      withStore(async (ctx) => {
        const { uploader, groupId } = await setup(ctx);
        await ready(ctx, groupId, uploader, { title: "A", typeId: "notes", details: { subject: "Maths" } });
        await ready(ctx, groupId, uploader, { title: "B", typeId: "pyq", details: { subject: "maths" } });
        await ready(ctx, groupId, uploader, { title: "C", typeId: "pyq", details: { subject: "Physics" } });
        await ready(ctx, groupId, uploader, { title: "D", typeId: "other", typeOther: "Lab manual", details: {} });
        const list = (query: Partial<Parameters<ResourceStore["list"]>[1]>) => listTitles(ctx, groupId, query);

        expect(await list({ typeId: "pyq" })).toEqual(["C", "B"]);
        expect(await list({ typeId: "other" })).toEqual(["D"]);
        expect(await list({ typeId: "assignment" })).toEqual([]);
        expect(await list({ typeId: "PYQ" })).toEqual([]);
        expect(await list({ details: [textFilter("subject", "MATHS")] })).toEqual(["B", "A"]);
        expect(await list({ details: [textFilter("subject", "Physic")] })).toEqual([]);
        // An empty value finds the files with no answer.
        expect(await list({ details: [textFilter("subject", "")] })).toEqual(["D"]);
        expect(await list({ typeId: "pyq", details: [textFilter("subject", "maths")] })).toEqual(["B"]);
        expect(await list({ typeId: "notes", details: [textFilter("subject", "Physics")] })).toEqual([]);
        expect(await list({ typeId: "pyq", details: [textFilter("subject", "Physics")], search: searchFor("c") })).toEqual(["C"]);
        // A detail the files do not have matches nothing.
        expect(await list({ details: [textFilter("nope", "Maths")] })).toEqual([]);
      }));

    test("a dropdown filter matches the choice id exactly, and several detail filters must all match", () =>
      withStore(async (ctx) => {
        const { uploader, groupId } = await setup(ctx);
        await ready(ctx, groupId, uploader, { title: "A", details: { semester: "s_one", year: "y_2024" } });
        await ready(ctx, groupId, uploader, { title: "B", details: { semester: "s_one", year: "y_2025" } });
        await ready(ctx, groupId, uploader, { title: "C", details: { semester: "S_ONE" } });
        await ready(ctx, groupId, uploader, { title: "D", details: { semester: "s_two", year: "y_2024" } });
        await ready(ctx, groupId, uploader, { title: "E", details: {} });
        const list = (details: DetailFilter[]) => listTitles(ctx, groupId, { details });

        expect(await list([choiceFilter("semester", "s_one")])).toEqual(["B", "A"]);
        // A choice id is not typed text: letter case matters, as does being the whole value.
        expect(await list([choiceFilter("semester", "S_one")])).toEqual([]);
        expect(await list([choiceFilter("semester", "s_")])).toEqual([]);
        expect(await list([choiceFilter("semester", "S_ONE")])).toEqual(["C"]);
        expect(await list([choiceFilter("semester", "s_one"), choiceFilter("year", "y_2024")])).toEqual(["A"]);
        expect(await list([choiceFilter("semester", "s_one"), choiceFilter("year", "y_2025"), textFilter("subject", "")])).toEqual(["B"]);
        expect(await list([choiceFilter("semester", "s_two"), choiceFilter("year", "y_2025")])).toEqual([]);
        expect(await list([choiceFilter("year", "")])).toEqual(["E", "C"]);
        // The value is compared as it is: % and _ are not wildcards, in either kind of filter.
        expect(await list([choiceFilter("semester", "%")])).toEqual([]);
        expect(await list([choiceFilter("semester", "s_on_")])).toEqual([]);
        expect(await list([textFilter("semester", "s%")])).toEqual([]);
      }));

    test("filters keep their meaning across pages", () =>
      withStore(async (ctx) => {
        const { uploader, groupId } = await setup(ctx);
        for (let n = 1; n <= 5; n++) {
          await ready(ctx, groupId, uploader, { title: `Chem ${n}`, typeId: "notes", details: { subject: "Chemistry", semester: "s_one" } });
          await ready(ctx, groupId, uploader, { title: `Hist ${n}`, typeId: "pyq", details: { subject: "History", semester: "s_one" } });
        }
        const pages = await allPages(ctx.store, groupId, {
          limit: 2,
          typeId: "notes",
          details: [textFilter("subject", "chemistry"), choiceFilter("semester", "s_one")],
          search: searchFor("chem"),
        });
        expect(titles(pages.flat())).toEqual(["Chem 5", "Chem 4", "Chem 3", "Chem 2", "Chem 1"]);
        expect(pages.map((p) => p.length)).toEqual([2, 2, 1]);
      }));

    test("searches title, file name, Other text and the named text details, ignoring letter case", () =>
      withStore(async (ctx) => {
        const { uploader, groupId } = await setup(ctx);
        await ready(ctx, groupId, uploader, { title: "Organic Chemistry", details: { subject: "Science" }, fileName: "a.pdf" });
        await ready(ctx, groupId, uploader, { title: "Week 1", details: { subject: "Thermodynamics" }, fileName: "b.pdf" });
        await ready(ctx, groupId, uploader, { title: "Week 2", details: { subject: "Art" }, fileName: "Lecture-Scan.PNG" });
        await ready(ctx, groupId, uploader, { title: "Week 3", typeId: "other", typeOther: "Lab Manual", details: {}, fileName: "c.pdf" });
        const find = (word: string, over: Partial<ResourceSearch> = {}) => listTitles(ctx, groupId, { search: searchFor(word, over) });

        expect(await find("chemistry")).toEqual(["Organic Chemistry"]);
        expect(await find("THERMO")).toEqual(["Week 1"]);
        expect(await find("lecture-scan")).toEqual(["Week 2"]);
        expect(await find("lab manual")).toEqual(["Week 3"]);
        expect(await find("MANUAL")).toEqual(["Week 3"]);
        expect(await find("week")).toEqual(["Week 3", "Week 2", "Week 1"]);
        expect(await find("organic chemistry")).toEqual(["Organic Chemistry"]);
        expect(await find("  chemistry  ")).toEqual(["Organic Chemistry"]);
        expect(await find("nothing like this")).toEqual([]);
        // A blank search is no search, whatever ids come with it.
        expect(await find("")).toHaveLength(4);
        expect(await find("   ")).toHaveLength(4);
        expect(await find("", { typeIds: ["other"], optionIds: ["nope"] })).toHaveLength(4);

        // A typed answer is searched only for the details named in textFieldIds.
        expect(await find("thermo", { textFieldIds: [] })).toEqual([]);
        expect(await find("thermo", { textFieldIds: ["other_field"] })).toEqual([]);
        expect(await find("thermo", { textFieldIds: ["other_field", "subject"] })).toEqual(["Week 1"]);
      }));

    test("a search also finds files by type id and by choice id, and still combines with the filters", () =>
      withStore(async (ctx) => {
        const { uploader, groupId } = await setup(ctx);
        await ready(ctx, groupId, uploader, { title: "Plain", typeId: "notes", details: {} });
        await ready(ctx, groupId, uploader, { title: "Past paper", typeId: "pyq", details: { subject: "Maths" } });
        await ready(ctx, groupId, uploader, { title: "Sem two", typeId: "notes", details: { semester: "s_two" } });
        await ready(ctx, groupId, uploader, { title: "Sem two paper", typeId: "pyq", details: { semester: "s_two" } });
        await ready(ctx, groupId, uploader, { title: "Sem one", typeId: "notes", details: { semester: "s_one" } });
        await ready(ctx, groupId, uploader, { title: "Typed like a choice", typeId: "notes", details: { subject: "s_two" } });
        const find = (word: string, over: Partial<ResourceSearch>, more: Partial<Parameters<ResourceStore["list"]>[1]> = {}) =>
          listTitles(ctx, groupId, { search: searchFor(word, over), ...more });

        // "previous" is in no title, but the caller mapped it to the type id pyq.
        expect(await find("previous", { typeIds: ["pyq"] })).toEqual(["Sem two paper", "Past paper"]);
        expect(await find("previous", {})).toEqual([]);
        // "semester 2" is in no title either; the caller mapped it to the choice id s_two. The
        // match is on the stored value, whatever the detail's id is.
        expect(await find("semester 2", { optionIds: ["s_two"] })).toEqual(["Typed like a choice", "Sem two paper", "Sem two"]);
        expect(await find("semester 2", { optionIds: ["s_two"], textFieldIds: [] })).toEqual(["Typed like a choice", "Sem two paper", "Sem two"]);
        // Title text, type ids and choice ids are alternatives (OR) ...
        expect(await find("plain", { typeIds: ["pyq"], optionIds: ["s_one"] })).toEqual(["Sem one", "Sem two paper", "Past paper", "Plain"]);
        // ... and the whole search still combines with filters (AND).
        expect(await find("semester 2", { optionIds: ["s_two"] }, { typeId: "pyq" })).toEqual(["Sem two paper"]);
        expect(await find("semester 2", { optionIds: ["s_two"] }, { details: [choiceFilter("semester", "s_two")] })).toEqual([
          "Sem two paper",
          "Sem two",
        ]);
        // Ids are compared whole and as they are: no wildcards, no letter-case folding.
        expect(await find("x", { typeIds: ["p%"] })).toEqual([]);
        expect(await find("x", { typeIds: ["PYQ"] })).toEqual([]);
        expect(await find("x", { optionIds: ["s_tw_"] })).toEqual([]);
        expect(await find("x", { optionIds: ["S_TWO"] })).toEqual([]);
      }));

    test("percent, underscore and backslash in a search are ordinary characters", () =>
      withStore(async (ctx) => {
        const { uploader, groupId } = await setup(ctx);
        await ready(ctx, groupId, uploader, { title: "100% sure", details: {}, fileName: "one.pdf" });
        await ready(ctx, groupId, uploader, { title: "1000 sure", details: {}, fileName: "two.pdf" });
        await ready(ctx, groupId, uploader, { title: "snake_case", details: {}, fileName: "three.pdf" });
        await ready(ctx, groupId, uploader, { title: "snakeXcase", details: {}, fileName: "four.pdf" });
        await ready(ctx, groupId, uploader, { title: "C:\\temp", details: {}, fileName: "five.pdf" });
        await ready(ctx, groupId, uploader, { title: "C:Xtemp", details: {}, fileName: "six.pdf" });
        await ready(ctx, groupId, uploader, { title: "plain", details: {}, fileName: "my_file%1.pdf" });
        await ready(ctx, groupId, uploader, { title: "typed", typeId: "other", typeOther: "50%_off", details: { subject: "a_b%" } });
        await ready(ctx, groupId, uploader, { title: "decoy", typeId: "other", typeOther: "50XXoff", details: { subject: "aXbY" } });
        const find = (word: string) => listTitles(ctx, groupId, { search: searchFor(word) });

        expect(await find("100%")).toEqual(["100% sure"]);
        expect(await find("%")).toEqual(["typed", "plain", "100% sure"]);
        expect(await find("_")).toEqual(["typed", "plain", "snake_case"]);
        expect(await find("e_c")).toEqual(["snake_case"]);
        expect(await find("\\")).toEqual(["C:\\temp"]);
        expect(await find("C:\\t")).toEqual(["C:\\temp"]);
        expect(await find("\\%")).toEqual([]);
        expect(await find("my_file%1")).toEqual(["plain"]);
        // The Other text and a text detail are searched the same literal way.
        expect(await find("50%_off")).toEqual(["typed"]);
        expect(await find("a_b%")).toEqual(["typed"]);
      }));

    test("lists each value of a text detail once, without the empty one, ordered by bytes, from ready files only", () =>
      withStore(async (ctx) => {
        const { uploader, groupId } = await setup(ctx);
        await ready(ctx, groupId, uploader, { details: { subject: "maths" } });
        await ready(ctx, groupId, uploader, { details: { subject: "Maths" } });
        await ready(ctx, groupId, uploader, { details: { subject: "Zoology" } });
        await ready(ctx, groupId, uploader, { details: { subject: "biology" } });
        await ready(ctx, groupId, uploader, { details: { subject: "biology" } });
        await ready(ctx, groupId, uploader, { details: { subject: "" } });
        await ready(ctx, groupId, uploader, { details: {} });
        await ready(ctx, groupId, uploader, { details: { other_detail: "Only elsewhere" } });
        await pending(ctx, groupId, uploader, { details: { subject: "Pending only" } });
        const gone = await ready(ctx, groupId, uploader, { details: { subject: "Deleted only" } });
        await ctx.store.softDelete(groupId, gone.id);

        // "Maths" and "maths" are one value (the filter ignores case); the one kept is the
        // first by bytes, a capital before a small letter.
        expect(await ctx.store.listDetailValues(groupId, "subject")).toEqual(["biology", "Maths", "Zoology"]);
        expect(await ctx.store.listDetailValues(groupId, "other_detail")).toEqual(["Only elsewhere"]);
        expect(await ctx.store.listDetailValues(groupId, "unknown_detail")).toEqual([]);
        expect(await ctx.store.listDetailValues(groupId, "")).toEqual([]);
        expect(await ctx.store.listDetailValues(groupId, "__proto__")).toEqual([]);
      }));

    test("usedOptionIds lists the type ids and detail values that ready files use, and nothing else", () =>
      withStore(async (ctx) => {
        const { uploader, groupId } = await setup(ctx);
        expect(await ctx.store.usedOptionIds(groupId, ALL)).toEqual({ typeIds: [], detailValues: {} });

        await ready(ctx, groupId, uploader, { typeId: "pyq", details: { semester: "s_two", year: "y_2024", subject: "Maths" } });
        await ready(ctx, groupId, uploader, { typeId: "pyq", details: { semester: "s_one" } });
        await ready(ctx, groupId, uploader, { typeId: "other", typeOther: "Lab manual", details: { semester: "s_two", subject: "" } });
        await ready(ctx, groupId, uploader, { typeId: "k3j9x", details: {} });
        await pending(ctx, groupId, uploader, { typeId: "assignment", details: { semester: "s_pending" } });
        const gone = await ready(ctx, groupId, uploader, { typeId: "study_material", details: { semester: "s_deleted", extra: "x" } });
        await ctx.store.softDelete(groupId, gone.id);

        expect(await ctx.store.usedOptionIds(groupId, ALL)).toEqual({
          typeIds: ["k3j9x", "other", "pyq"],
          detailValues: { semester: ["s_one", "s_two"], subject: ["Maths"], year: ["y_2024"] },
        });
      }));

    test("usedOptionIds is per group, and gone with a deleted group", () =>
      withStore(async (ctx) => {
        const { uploader, groupId } = await setup(ctx);
        const other = await ctx.newGroup(uploader);
        await ready(ctx, groupId, uploader, { typeId: "pyq", details: { semester: "s_mine" } });
        await ready(ctx, other, uploader, { typeId: "assignment", details: { semester: "s_theirs" } });
        expect(await ctx.store.usedOptionIds(groupId, ["semester"])).toEqual({ typeIds: ["pyq"], detailValues: { semester: ["s_mine"] } });
        expect(await ctx.store.usedOptionIds(other, ["semester"])).toEqual({ typeIds: ["assignment"], detailValues: { semester: ["s_theirs"] } });
        await ctx.deleteGroup(groupId);
        expect(await ctx.store.usedOptionIds(groupId, ["semester"])).toEqual({ typeIds: [], detailValues: {} });
      }));

    test("usedOptionIds returns the values of the details it is asked about, and of no other (a text detail's free text stays in the database)", () =>
      withStore(async (ctx) => {
        const { uploader, groupId } = await setup(ctx);
        await ready(ctx, groupId, uploader, { typeId: "pyq", details: { semester: "s_one", year: "y_2024", subject: "Maths", note: "private words" } });
        await ready(ctx, groupId, uploader, { typeId: "notes", details: { semester: "s_two", subject: "Physics" } });

        expect(await ctx.store.usedOptionIds(groupId, ["semester"])).toEqual({
          typeIds: ["notes", "pyq"],
          detailValues: { semester: ["s_one", "s_two"] },
        });
        expect(await ctx.store.usedOptionIds(groupId, ["year", "semester"])).toEqual({
          typeIds: ["notes", "pyq"],
          detailValues: { semester: ["s_one", "s_two"], year: ["y_2024"] },
        });
        // No details asked for: the types only.
        expect(await ctx.store.usedOptionIds(groupId, [])).toEqual({ typeIds: ["notes", "pyq"], detailValues: {} });
        // A detail nobody has a value for, a repeated id and the empty id add nothing.
        expect(await ctx.store.usedOptionIds(groupId, ["nobody", "semester", "semester", ""])).toEqual({
          typeIds: ["notes", "pyq"],
          detailValues: { semester: ["s_one", "s_two"] },
        });
        // Ids are compared exactly: not by case, not by prefix, and not as a pattern.
        expect(await ctx.store.usedOptionIds(groupId, ["SEMESTER", "sem", "sem%", "%", "_emester"])).toEqual({
          typeIds: ["notes", "pyq"],
          detailValues: {},
        });
      }));

    test("usedOptionIds takes any text as a detail id without failing", () =>
      withStore(async (ctx) => {
        const { uploader, groupId } = await setup(ctx);
        await ready(ctx, groupId, uploader, { typeId: "notes", details: { semester: "s_one" } });
        const odd = ["a\u0000b", "bad\ud800", "'; drop table groups; --", "x".repeat(5000), "__proto__", "constructor", '{"a":1}'];
        expect(await ctx.store.usedOptionIds(groupId, odd)).toEqual({ typeIds: ["notes"], detailValues: {} });
        expect(await ctx.store.usedOptionIds(groupId, [...odd, "semester"])).toEqual({ typeIds: ["notes"], detailValues: { semester: ["s_one"] } });
      }));

    test("detail ids that look like object keys stay plain data in usedOptionIds", () =>
      withStore(async (ctx) => {
        const { uploader, groupId } = await setup(ctx);
        await ready(ctx, groupId, uploader, { details: Object.fromEntries([["__proto__", "v1"]]) });
        const used = await ctx.store.usedOptionIds(groupId, ["__proto__"]);
        expect(Object.getPrototypeOf(used.detailValues)).toBe(Object.prototype);
        expect(Object.hasOwn(used.detailValues, "__proto__")).toBe(true);
        expect(Object.entries(used.detailValues)).toEqual([["__proto__", ["v1"]]]);
      }));

    test("values and lists are per group", () =>
      withStore(async (ctx) => {
        const { uploader, groupId } = await setup(ctx);
        const other = await ctx.newGroup(uploader);
        await ready(ctx, groupId, uploader, { title: "Mine", typeId: "pyq", details: { subject: "Art", semester: "s_one" } });
        await ready(ctx, other, uploader, { title: "Theirs", typeId: "pyq", details: { subject: "Music", semester: "s_one" } });
        expect(await ctx.store.listDetailValues(groupId, "subject")).toEqual(["Art"]);
        expect(await ctx.store.listDetailValues(other, "subject")).toEqual(["Music"]);
        expect(titles((await ctx.store.list(groupId, { limit: 10 })).items)).toEqual(["Mine"]);
        expect(titles((await ctx.store.list(other, { limit: 10 })).items)).toEqual(["Theirs"]);
        // Filters and searches never reach another group's files, whatever ids they carry.
        const hostile = {
          limit: 10,
          typeId: "pyq",
          details: [choiceFilter("semester", "s_one")],
          search: searchFor("", { typeIds: ["pyq"], optionIds: ["s_one"] }),
        };
        expect(titles((await ctx.store.list(groupId, hostile)).items)).toEqual(["Mine"]);
        expect(titles((await ctx.store.list(groupId, { ...hostile, search: searchFor("theirs") })).items)).toEqual([]);
        expect(titles((await ctx.store.list(groupId, { limit: 10, details: [textFilter("subject", "music")] })).items)).toEqual([]);
      }));

    test("a file is only found through its own group", () =>
      withStore(async (ctx) => {
        const { uploader, groupId } = await setup(ctx);
        const other = await ctx.newGroup(uploader);
        const record = await ready(ctx, groupId, uploader);
        expect(await ctx.store.findById(other, record.id)).toBeNull();
        expect(await ctx.store.update(other, record.id, answers({ title: "Hijack", typeId: "other" }))).toBeNull();
        expect(await ctx.store.softDelete(other, record.id)).toBeNull();
        expect(await ctx.store.findById(groupId, record.id)).toEqual(record);
      }));

    test("update changes title, type and answers, also while the file is uploading", () =>
      withStore(async (ctx) => {
        const { uploader, groupId } = await setup(ctx);
        const wait = await pending(ctx, groupId, uploader);
        const early = await ctx.store.update(groupId, wait.id, answers({ title: "Early", typeId: "other", typeOther: "Poster" }));
        expect(early).toMatchObject({ id: wait.id, title: "Early", typeId: "other", typeOther: "Poster", details: {}, status: "uploading" });

        const record = await ready(ctx, groupId, uploader, {
          title: "Old",
          typeId: "notes",
          details: { subject: "Old subject", semester: "s_one" },
        });
        const updated = await ctx.store.update(
          groupId,
          record.id,
          answers({ title: "New", typeId: "assignment", details: { subject: "New subject", year: "y_2025" } }),
        );
        // The details are replaced as a whole: semester is gone because the caller did not send it.
        expect(updated).toEqual({
          ...record,
          title: "New",
          typeId: "assignment",
          typeOther: "",
          details: { subject: "New subject", year: "y_2025" },
        });
        expect(await ctx.store.findById(groupId, record.id)).toEqual(updated);
        expect((await ctx.store.list(groupId, { limit: 10, typeId: "assignment" })).items).toEqual([updated]);
        expect(await ctx.store.listDetailValues(groupId, "subject")).toEqual(["New subject"]);
        expect((await ctx.store.list(groupId, { limit: 10, details: [choiceFilter("semester", "s_one")] })).items).toEqual([]);
        expect(await ctx.store.usedOptionIds(groupId, ALL)).toEqual({
          typeIds: ["assignment"],
          detailValues: { subject: ["New subject"], year: ["y_2025"] },
        });
      }));

    test("update finds nothing for an unknown or deleted file", () =>
      withStore(async (ctx) => {
        const { uploader, groupId } = await setup(ctx);
        const record = await ready(ctx, groupId, uploader);
        expect(await ctx.store.update(groupId, crypto.randomUUID(), answers())).toBeNull();
        await ctx.store.softDelete(groupId, record.id);
        expect(await ctx.store.update(groupId, record.id, answers())).toBeNull();
      }));

    test("softDelete returns the file, hides it everywhere, and works once", () =>
      withStore(async (ctx) => {
        const { uploader, groupId } = await setup(ctx);
        const keep = await ready(ctx, groupId, uploader, { title: "Keep", details: { subject: "Art" } });
        const record = await ready(ctx, groupId, uploader, { title: "Remove", details: { subject: "Music" } });
        const removed = await ctx.store.softDelete(groupId, record.id);
        expect(removed).toEqual(record);
        expect(removed?.fileKey).toBe(record.fileKey);

        expect(await ctx.store.findById(groupId, record.id)).toBeNull();
        expect(await ctx.store.list(groupId, { limit: 10 })).toEqual({ items: [keep], nextCursor: null });
        expect(await ctx.store.list(groupId, { limit: 10, search: searchFor("remove") })).toEqual(none);
        expect(await ctx.store.list(groupId, { limit: 10, details: [textFilter("subject", "music")] })).toEqual(none);
        expect(await ctx.store.listDetailValues(groupId, "subject")).toEqual(["Art"]);
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
        expect(await ctx.store.list(groupId, { limit: 10 })).toEqual(none);
        expect(await ctx.store.list(groupId, { limit: 10, typeId: "notes", details: [textFilter("subject", "Biology")] })).toEqual(none);
        expect(await ctx.store.listDetailValues(groupId, "subject")).toEqual([]);
        expect(await ctx.store.usedOptionIds(groupId, ALL)).toEqual({ typeIds: [], detailValues: {} });
        expect(await ctx.store.markReady(waiting.id, groupId)).toBeNull();
        expect(await ctx.store.update(groupId, done.id, answers())).toBeNull();
        expect(await ctx.store.softDelete(groupId, done.id)).toBeNull();
        await expect(ctx.store.createPending(fileInput(groupId, uploader))).rejects.toThrow();
      }));

    test("createPending fails for a group that does not exist or an uploader who has no account", () =>
      withStore(async (ctx) => {
        const { uploader, groupId } = await setup(ctx);
        await expect(ctx.store.createPending(fileInput(crypto.randomUUID(), uploader))).rejects.toThrow();
        await expect(ctx.store.createPending(fileInput(groupId, crypto.randomUUID()))).rejects.toThrow();
        expect(await ctx.store.list(groupId, { limit: 10 })).toEqual(none);
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
          { typeId: "" },
          { typeId: "x".repeat(65) },
          { typeOther: "x".repeat(41) },
          { typeId: "a\u0000b" },
          { typeOther: "a\u0000b" },
          { details: { "a\u0000b": "x" } },
          { details: { a: "x\u0000y" } },
          { fileName: "" },
          { fileName: "x".repeat(RESOURCE_LIMITS.maxFileName + 1) },
          { sizeBytes: 0 },
          { sizeBytes: -1 },
        ];
        for (const over of refused) {
          await expect(ctx.store.createPending(fileInput(groupId, uploader, over)), JSON.stringify(over).slice(0, 60)).rejects.toThrow();
        }
        expect(await ctx.store.list(groupId, { limit: 10 })).toEqual(none);

        const edge = await ctx.store.createPending(
          fileInput(groupId, uploader, {
            title: "x".repeat(RESOURCE_LIMITS.maxTitle),
            typeId: "t".repeat(64),
            typeOther: "o".repeat(40),
            details: { subject: "y".repeat(100) },
            fileName: "z".repeat(RESOURCE_LIMITS.maxFileName),
            sizeBytes: RESOURCE_LIMITS.maxFileBytes,
          }),
        );
        expect(edge.sizeBytes).toBe(RESOURCE_LIMITS.maxFileBytes);
        expect(edge).toMatchObject({ typeId: "t".repeat(64), typeOther: "o".repeat(40) });
        // Characters people see are counted, so 120 emoji fit and are not 240; so do 40 in the Other text.
        await ctx.store.createPending(fileInput(groupId, uploader, { title: "😀".repeat(RESOURCE_LIMITS.maxTitle) }));
        await ctx.store.createPending(fileInput(groupId, uploader, { typeId: "other", typeOther: "😀".repeat(40) }));
        // No details at all is fine.
        await ctx.store.createPending(fileInput(groupId, uploader, { details: {} }));
      }));

    test("update refuses values outside the limits and changes nothing", () =>
      withStore(async (ctx) => {
        const { uploader, groupId } = await setup(ctx);
        const record = await ready(ctx, groupId, uploader);
        const refused = [
          answers({ title: "" }),
          answers({ title: "   " }),
          answers({ title: "x".repeat(RESOURCE_LIMITS.maxTitle + 1) }),
          answers({ title: "T", typeId: "" }),
          answers({ title: "T", typeId: "x".repeat(65) }),
          answers({ title: "T", typeId: "other", typeOther: "x".repeat(41) }),
          answers({ title: "T", typeId: "a\u0000b" }),
          answers({ title: "T", details: { subject: "a\u0000b" } }),
          answers({ title: "T", details: { "a\u0000b": "x" } }),
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
        expect((await ctx.store.update(groupId, record.id, answers({ title: "Renamed" })))?.uploaderId).toBeNull();
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
          expect(await ctx.store.list(bad, { limit: 10 })).toEqual(none);
          expect(await ctx.store.listDetailValues(bad, "subject")).toEqual([]);
          expect(await ctx.store.usedOptionIds(bad, ALL)).toEqual({ typeIds: [], detailValues: {} });
          expect(await ctx.store.update(bad, record.id, answers())).toBeNull();
          expect(await ctx.store.update(groupId, bad, answers())).toBeNull();
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
        expect((await ctx.store.usedOptionIds(groupId.toUpperCase(), ALL)).typeIds).toEqual(["notes"]);
        expect(await ctx.store.listDetailValues(groupId.toUpperCase(), "subject")).toEqual(["Biology"]);
      }));

    test("text that cannot be stored matches nothing instead of failing", () =>
      withStore(async (ctx) => {
        const { uploader, groupId } = await setup(ctx);
        await ready(ctx, groupId, uploader);
        const nul = "a\u0000b";
        expect(await ctx.store.list(groupId, { limit: 10, search: searchFor(nul) })).toEqual(none);
        expect(await ctx.store.list(groupId, { limit: 10, typeId: nul })).toEqual(none);
        expect(await ctx.store.list(groupId, { limit: 10, details: [textFilter("subject", nul)] })).toEqual(none);
        expect(await ctx.store.list(groupId, { limit: 10, details: [choiceFilter(nul, "x")] })).toEqual(none);
        expect(await ctx.store.listDetailValues(groupId, nul)).toEqual([]);
        // An id with a NUL in a search's lists can match no file, so it is ignored and the rest still works.
        const list = await ctx.store.list(groupId, {
          limit: 10,
          search: searchFor("cell", { typeIds: [nul], optionIds: [nul], textFieldIds: [nul] }),
        });
        expect(titles(list.items)).toEqual(["Cell biology notes"]);
        const byId = await ctx.store.list(groupId, { limit: 10, search: searchFor("zzz", { typeIds: [nul, "notes"] }) });
        expect(titles(byId.items)).toEqual(["Cell biology notes"]);
      }));
  });
}
