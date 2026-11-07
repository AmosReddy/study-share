import { describe, expect, test } from "vitest";
import { getSiteUrl } from "./site-url";

describe("getSiteUrl", () => {
  test("prefers NEXT_PUBLIC_SITE_URL", () => {
    expect(
      getSiteUrl({
        NEXT_PUBLIC_SITE_URL: "https://study.example.com",
        VERCEL_BRANCH_URL: "branch.vercel.app",
        VERCEL_URL: "deploy.vercel.app",
      }),
    ).toBe("https://study.example.com");
  });

  test("then the branch address", () => {
    expect(getSiteUrl({ VERCEL_BRANCH_URL: "branch.vercel.app", VERCEL_URL: "deploy.vercel.app" })).toBe(
      "https://branch.vercel.app",
    );
  });

  test("then the deployment address", () => {
    expect(getSiteUrl({ VERCEL_URL: "deploy.vercel.app" })).toBe("https://deploy.vercel.app");
  });

  test("then localhost", () => {
    expect(getSiteUrl({})).toBe("http://localhost:3000");
  });

  test("never ends with a slash", () => {
    expect(getSiteUrl({ NEXT_PUBLIC_SITE_URL: "https://study.example.com/" })).toBe("https://study.example.com");
    expect(getSiteUrl({ NEXT_PUBLIC_SITE_URL: "https://study.example.com///" })).toBe("https://study.example.com");
  });

  test("a garbage NEXT_PUBLIC_SITE_URL falls through to the next source", () => {
    expect(getSiteUrl({ NEXT_PUBLIC_SITE_URL: "not a url", VERCEL_BRANCH_URL: "branch.vercel.app" })).toBe(
      "https://branch.vercel.app",
    );
    expect(getSiteUrl({ NEXT_PUBLIC_SITE_URL: "garbage" })).toBe("http://localhost:3000");
  });

  test("an empty setting counts as not set", () => {
    expect(getSiteUrl({ NEXT_PUBLIC_SITE_URL: "", VERCEL_URL: "deploy.vercel.app" })).toBe(
      "https://deploy.vercel.app",
    );
  });
});
