import { describe, expect, it } from "vitest";
import { cleanUpUsers, type DeleteOutcome } from "./clean-up-users";

const deleter = (outcomes: Record<string, DeleteOutcome> = {}, seen: string[] = []) => async (id: string): Promise<DeleteOutcome> => {
  seen.push(id);
  return outcomes[id] ?? "deleted";
};

const scanOf = (ids: string[], complete = true) => async () => ({ ids, complete });

describe("cleanUpUsers", () => {
  it("deletes every recorded id and says 0 left when the scan finds nothing more", async () => {
    const seen: string[] = [];
    const result = await cleanUpUsers({ knownIds: ["u1", "u2"], scan: scanOf([]), deleteUser: deleter({}, seen) });
    expect(seen).toEqual(["u1", "u2"]);
    expect(result).toMatchObject({ deleted: 2, left: 0, warnings: [] });
    expect(result.summary).toBe("Clean-up: 2 test user(s) deleted, 0 left.");
  });

  it("deletes a user only the scan finds, and never deletes one twice", async () => {
    const seen: string[] = [];
    const result = await cleanUpUsers({ knownIds: ["u1"], scan: scanOf(["u1", "u3"]), deleteUser: deleter({}, seen) });
    expect(seen).toEqual(["u1", "u3"]);
    expect(result).toMatchObject({ deleted: 2, left: 0 });
  });

  it("counts a failed delete as left, with a warning that shows only the id", async () => {
    const result = await cleanUpUsers({ knownIds: ["u1", "u2"], scan: scanOf(["u1", "u2"]), deleteUser: deleter({ u2: "failed" }) });
    expect(result).toMatchObject({ deleted: 1, left: 1 });
    expect(result.warnings).toEqual(["test user u2 was not deleted; remove it in the dashboard"]);
    expect(result.summary).toBe("Clean-up: 1 test user(s) deleted, 1 left.");
  });

  it("counts a delete that throws as left", async () => {
    const result = await cleanUpUsers({
      knownIds: ["u1"],
      scan: scanOf([]),
      deleteUser: async () => {
        throw new Error("network down");
      },
    });
    expect(result).toMatchObject({ deleted: 0, left: 1 });
  });

  it("counts a failed scan as left, because the clean-up cannot know nothing remains", async () => {
    const result = await cleanUpUsers({
      knownIds: ["u1"],
      scan: async () => {
        throw new Error("listUsers failed");
      },
      deleteUser: deleter(),
    });
    expect(result.deleted).toBe(1);
    expect(result.left).toBe(1);
    expect(result.warnings).toEqual(["could not list users to check for leftovers; look for test addresses tagged check in the dashboard"]);
    expect(result.summary).not.toContain("0 left");
  });

  it("counts a scan cut off at its page limit as left", async () => {
    const result = await cleanUpUsers({ knownIds: [], scan: scanOf([], false), deleteUser: deleter() });
    expect(result.left).toBe(1);
    expect(result.warnings).toEqual(["the user scan stopped at its page limit, so leftovers cannot be ruled out; check the dashboard"]);
    expect(result.summary).not.toContain("0 left");
  });

  it("does not count a user that is already gone as deleted or left", async () => {
    const result = await cleanUpUsers({ knownIds: ["u1"], scan: scanOf([]), deleteUser: deleter({ u1: "gone" }) });
    expect(result).toMatchObject({ deleted: 0, left: 0 });
    expect(result.summary).toBe("Clean-up: 0 test user(s) deleted, 0 left.");
  });

  it("still tries the scan when a recorded delete failed, without retrying that id", async () => {
    const seen: string[] = [];
    const result = await cleanUpUsers({ knownIds: ["u1"], scan: scanOf(["u1", "u2"]), deleteUser: deleter({ u1: "failed" }, seen) });
    expect(seen).toEqual(["u1", "u2"]);
    expect(result).toMatchObject({ deleted: 1, left: 1 });
  });
});
