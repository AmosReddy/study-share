import { expect, test, vi } from "vitest";
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

test("logs why the check failed on the server, without any connection URL", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  await checkHealth(async () => {
    throw new Error("connect postgres://user:hunter2@db.example.com failed");
  });
  const logged = log.mock.calls.flat().join(" ");
  log.mockRestore();
  expect(logged).toContain("connect");
  expect(logged).not.toContain("hunter2");
  expect(logged).not.toContain("db.example.com");
});
