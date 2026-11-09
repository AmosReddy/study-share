import { describe, expect, it } from "vitest";
import { BRAND } from "@/shared/brand";
import manifest from "./manifest";

describe("web app manifest", () => {
  const m = manifest();

  it("is installable as a standalone app starting at /", () => {
    expect(m.name).toBe("study-share");
    expect(m.short_name).toBe("study-share");
    expect(m.start_url).toBe("/");
    expect(m.display).toBe("standalone");
  });

  it("uses the paper and ink colours of the palette", () => {
    expect(m.background_color).toBe(BRAND.paper);
    expect(m.theme_color).toBe(BRAND.ink);
  });

  it("lists a 192 and a 512 PNG icon", () => {
    expect(m.icons?.map((i) => [i.sizes, i.type])).toEqual([
      ["192x192", "image/png"],
      ["512x512", "image/png"],
    ]);
  });
});

describe("brand colours", () => {
  it("match src/app/globals.css", async () => {
    const { readFile } = await import("node:fs/promises");
    const css = await readFile(new URL("./globals.css", import.meta.url), "utf8");
    const root = css.slice(css.indexOf(":root {"), css.indexOf(".dark {"));
    expect(root).toContain(`--background: ${BRAND.paper}`);
    expect(root).toContain(`--foreground: ${BRAND.ink}`);
    expect(root).toContain(`--highlight: ${BRAND.marker}`);
  });
});
