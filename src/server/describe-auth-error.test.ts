import { describe, expect, it } from "vitest";
import { describeAuthError, describeCodeShape } from "./describe-auth-error";

describe("describeAuthError", () => {
  it("says there was no error for null or undefined", () => {
    expect(describeAuthError(null)).toBe("no error");
    expect(describeAuthError(undefined)).toBe("no error");
  });

  it("gives the name, status and code, never the message", () => {
    const error = Object.assign(new Error("Token has expired for user@example.com"), {
      name: "AuthApiError",
      status: 403,
      code: "otp_expired",
    });
    expect(describeAuthError(error)).toBe("AuthApiError status 403 code otp_expired");
  });

  it("says none for a missing status or code", () => {
    expect(describeAuthError(new Error("boom with secret"))).toBe("Error status none code none");
  });

  it("reports a non-error value without showing it", () => {
    expect(describeAuthError("token=abc")).toBe("a non-error value");
  });
});

describe("describeCodeShape", () => {
  it("reports the length and a digits-only class without showing the code", () => {
    expect(describeCodeShape("123456")).toBe("6 characters, digits only");
  });

  it("reports other character classes", () => {
    expect(describeCodeShape("12ab56")).toBe("6 characters, letters and digits");
    expect(describeCodeShape("ab-cd!")).toBe("6 characters, other characters present");
  });

  it("handles a missing code", () => {
    expect(describeCodeShape(undefined)).toBe("no code");
    expect(describeCodeShape("")).toBe("no code");
  });
});
