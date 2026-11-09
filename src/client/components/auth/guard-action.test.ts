import { describe, expect, it } from "vitest";
import { AUTH_MESSAGES } from "@/shared/auth-messages";
import { IDLE, type FormState } from "@/shared/form-state";
import { guardAction } from "./guard-action";

const form = new FormData();

describe("guardAction", () => {
  it("passes the action's answer through", async () => {
    const answer: FormState = { status: "done", notice: "Saved." };
    expect(await guardAction(async () => answer)(IDLE, form)).toBe(answer);
  });

  it("turns a failed request (a network error) into the form's error and keeps what was typed", async () => {
    const previous: FormState = { status: "error", values: { name: "Maths" } };
    const guarded = guardAction(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await guarded(previous, form)).toEqual({
      status: "error",
      formError: AUTH_MESSAGES.actionFailed,
      values: { name: "Maths" },
    });
  });

  it("does not leak the error's text", async () => {
    const guarded = guardAction(async () => {
      throw new Error("secret detail from the server");
    });
    expect(JSON.stringify(await guarded(IDLE, form))).not.toContain("secret detail");
  });

  it("rethrows Next's control-flow errors (redirect, not found), which must reach the router", async () => {
    for (const digest of ["NEXT_REDIRECT;replace;/login;307;", "NEXT_HTTP_ERROR_FALLBACK;404", "NEXT_NOT_FOUND"]) {
      const flow = Object.assign(new Error("control flow"), { digest });
      await expect(
        guardAction(async () => {
          throw flow;
        })(IDLE, form),
      ).rejects.toBe(flow);
    }
  });

  it("treats an error with some other digest as a failure", async () => {
    const guarded = guardAction(async () => {
      throw Object.assign(new Error("boom"), { digest: "1234567" });
    });
    expect(await guarded(IDLE, form)).toMatchObject({ status: "error", formError: AUTH_MESSAGES.actionFailed });
  });
});
