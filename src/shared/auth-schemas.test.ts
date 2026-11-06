import { describe, expect, it } from "vitest";
import {
  displayNameSchema,
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  signUpSchema,
} from "./auth-schemas";

const valid = {
  displayName: "Ana",
  email: "ana@example.com",
  password: "correct horse",
  acceptTerms: true,
};

describe("signUpSchema", () => {
  it("accepts a valid input", () => {
    expect(signUpSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a 7-character password and accepts 8", () => {
    expect(signUpSchema.safeParse({ ...valid, password: "1234567" }).success).toBe(false);
    expect(signUpSchema.safeParse({ ...valid, password: "12345678" }).success).toBe(true);
  });

  it("rejects a 1-character and a 51-character name", () => {
    expect(signUpSchema.safeParse({ ...valid, displayName: "A" }).success).toBe(false);
    expect(signUpSchema.safeParse({ ...valid, displayName: "a".repeat(51) }).success).toBe(false);
    expect(signUpSchema.safeParse({ ...valid, displayName: "a".repeat(50) }).success).toBe(true);
  });

  it("rejects a bad email", () => {
    expect(signUpSchema.safeParse({ ...valid, email: "not-an-email" }).success).toBe(false);
  });

  it("requires acceptTerms to be true", () => {
    expect(signUpSchema.safeParse({ ...valid, acceptTerms: false }).success).toBe(false);
    const withoutTerms: Partial<typeof valid> = { ...valid };
    delete withoutTerms.acceptTerms;
    expect(signUpSchema.safeParse(withoutTerms).success).toBe(false);
  });

  it("trims the name and lowercases and trims the email", () => {
    const parsed = signUpSchema.parse({
      ...valid,
      displayName: "  Ana  ",
      email: "  Ana@Example.COM ",
    });
    expect(parsed.displayName).toBe("Ana");
    expect(parsed.email).toBe("ana@example.com");
  });

  it("never trims the password", () => {
    const parsed = signUpSchema.parse({ ...valid, password: "  spaced out  " });
    expect(parsed.password).toBe("  spaced out  ");
  });
});

describe("displayNameSchema", () => {
  it.each(["राम", "రాము", "Ana 🙂"])("accepts %s", (name) => {
    expect(displayNameSchema.safeParse(name).success).toBe(true);
  });

  it("counts characters, not UTF-16 units, so 50 emoji are allowed and 51 are not", () => {
    expect(displayNameSchema.safeParse("🙂".repeat(50)).success).toBe(true);
    expect(displayNameSchema.safeParse("🙂".repeat(51)).success).toBe(false);
  });

  it("rejects a name that is only spaces", () => {
    expect(displayNameSchema.safeParse("    ").success).toBe(false);
  });
});

describe("loginSchema", () => {
  it("accepts an email and a non-empty password and normalises the email", () => {
    const parsed = loginSchema.parse({ email: " Ana@Example.com ", password: "x" });
    expect(parsed.email).toBe("ana@example.com");
  });

  it("rejects an empty password and a bad email", () => {
    expect(loginSchema.safeParse({ email: "ana@example.com", password: "" }).success).toBe(false);
    expect(loginSchema.safeParse({ email: "nope", password: "x" }).success).toBe(false);
  });
});

describe("forgotPasswordSchema", () => {
  it("accepts and normalises an email, rejects a bad one", () => {
    expect(forgotPasswordSchema.parse({ email: " A@B.co " }).email).toBe("a@b.co");
    expect(forgotPasswordSchema.safeParse({ email: "nope" }).success).toBe(false);
  });
});

describe("resetPasswordSchema", () => {
  it("requires at least 8 characters", () => {
    expect(resetPasswordSchema.safeParse({ password: "1234567" }).success).toBe(false);
    expect(resetPasswordSchema.safeParse({ password: "12345678" }).success).toBe(true);
  });
});
