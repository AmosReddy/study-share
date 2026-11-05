import { expect, test } from "vitest";
import { checkHealth } from "./health";

test("reports healthy when the database responds", async () => {
  expect(await checkHealth(async () => {})).toEqual({
    httpStatus: 200,
    body: { status: "ok", db: "ok" },
  });
});

test("reports 503 and hides connection details when the database fails", async () => {
  const result = await checkHealth(async () => {
    throw new Error("connect postgres://user:hunter2@db.example.com failed");
  });
  expect(result.httpStatus).toBe(503);
  expect(result.body).toEqual({ status: "degraded", db: "error" });
  expect(JSON.stringify(result)).not.toContain("hunter2");
});
