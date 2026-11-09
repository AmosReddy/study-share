import { expect, test, type Page } from "@playwright/test";
import { isolateRateLimits, sidewaysOverflow, signUpAndConfirm, uniqueEmail } from "./helpers";

/*
  The home page in its two states, the account menu, the account page and the web app
  manifest, against the fake auth provider (SERVICES_MODE=fake).
*/

test.beforeEach(async ({ page }) => {
  await isolateRateLimits(page);
});

const isPhone = (projectName: string) => projectName.startsWith("phone");

/** The account menu button in the shell header: its accessible name is the person's name. */
const menuButton = (page: Page, name: string) => page.getByRole("banner").getByRole("button", { name, exact: true });

test.describe("home, signed out", () => {
  test("shows a short pitch with Sign up and Log in", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const signUp = page.getByRole("main").getByRole("link", { name: "Sign up", exact: true });
    const logIn = page.getByRole("main").getByRole("link", { name: "Log in", exact: true });
    await expect(signUp).toHaveAttribute("href", "/signup");
    await expect(logIn).toHaveAttribute("href", "/login");
    for (const link of [signUp, logIn]) {
      await expect(link).toBeVisible();
      expect((await link.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    }

    // The Phase 0 sample content is gone.
    await expect(page.getByText("No files here yet")).toHaveCount(0);
    await expect(page.getByText("CSE 2nd Year")).toHaveCount(0);
    expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
  });

  test("/account sends a signed-out person to log in, and back afterwards", async ({ page }) => {
    await page.goto("/account");
    await expect(page).toHaveURL("/login?next=%2Faccount");
  });
});

test.describe("home, signed in", () => {
  test("shows the name in the account menu and an honest empty state", async ({ page }) => {
    await signUpAndConfirm(page, { name: "Asha Rao" });
    await expect(menuButton(page, "Asha Rao")).toBeVisible();

    const create = page.getByRole("main").getByRole("button", { name: "Create a group" });
    const join = page.getByRole("main").getByRole("button", { name: "Join with a code" });
    await expect(create).toBeDisabled();
    await expect(join).toBeDisabled();
    await expect(page.getByRole("main").getByText("Coming in the next step")).toBeVisible();
    await expect(page.getByText("No files here yet")).toHaveCount(0);
    await expect(page.getByText("CSE 2nd Year")).toHaveCount(0);
  });

  test("the sidebar list says there are no groups yet", async ({ page }, info) => {
    await signUpAndConfirm(page, { name: "Asha Rao" });
    if (isPhone(info.project.name)) await page.getByRole("button", { name: "Open group list" }).click();
    const groups = page.getByRole("navigation", { name: "Groups" });
    await expect(groups).toBeVisible();
    await expect(groups.getByText("You are not in any groups yet.")).toBeVisible();
    await expect(groups.getByRole("link")).toHaveCount(0);
  });

  test("the menu works with the keyboard and offers Account and Log out", async ({ page }) => {
    const email = await signUpAndConfirm(page, { name: "Asha Rao" });
    const trigger = menuButton(page, "Asha Rao");
    await expect(trigger).toBeVisible();
    expect((await trigger.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);

    await trigger.focus();
    await page.keyboard.press("Enter");
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByText(email)).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Account" })).toHaveAttribute("href", "/account");
    await expect(menu.getByRole("menuitem", { name: "Log out" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("Log out returns to / signed out", async ({ page }) => {
    await signUpAndConfirm(page, { name: "Asha Rao" });
    await menuButton(page, "Asha Rao").click();
    await page.getByRole("menuitem", { name: "Log out" }).click();

    await expect(page).toHaveURL("/");
    await expect(page.getByRole("main").getByRole("link", { name: "Sign up", exact: true })).toBeVisible();
    await expect(page.getByRole("banner").getByRole("button", { name: "Asha Rao" })).toHaveCount(0);

    await page.goto("/account");
    await expect(page).toHaveURL("/login?next=%2Faccount");
  });
});

test.describe("account page", () => {
  test("shows the email read-only, saves a new name that persists and shows in the menu", async ({ page }) => {
    const email = await signUpAndConfirm(page, { name: "Asha Rao" });
    await menuButton(page, "Asha Rao").click();
    await page.getByRole("menuitem", { name: "Account" }).click();
    await expect(page).toHaveURL("/account");
    await expect(page.getByRole("heading", { name: "Account", level: 1 })).toBeVisible();
    await expect(page.getByRole("main").getByText(email)).toBeVisible();
    await expect(page.getByRole("main").getByLabel("Email")).toHaveCount(0);

    const name = page.getByLabel("Name", { exact: true });
    await expect(name).toHaveValue("Asha Rao");
    await expect(name).toHaveAttribute("autocomplete", "name");
    await name.fill("  Asha K. Rao  ");
    await page.getByRole("button", { name: "Save" }).click();

    await expect(page.getByText("Your name has been saved.")).toBeVisible();
    await expect(menuButton(page, "Asha K. Rao")).toBeVisible();
    await expect(name).toHaveValue("Asha K. Rao");

    await page.goto("/");
    await expect(menuButton(page, "Asha K. Rao")).toBeVisible();
  });

  test("a bad name keeps what was typed and ties the error to the field", async ({ page }) => {
    await signUpAndConfirm(page, { name: "Asha Rao" });
    await page.goto("/account");

    const name = page.getByLabel("Name", { exact: true });
    await name.fill("A");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Use at least 2 characters.")).toBeVisible();
    await expect(name).toHaveValue("A");
    await expect(name).toHaveAttribute("aria-invalid", "true");
    await expect(name).toHaveAccessibleDescription(/Use at least 2 characters\./);
    await expect(name).toBeFocused();
    await expect(menuButton(page, "Asha Rao")).toBeVisible();
  });

  test("Log out on the page signs out", async ({ page }) => {
    await signUpAndConfirm(page, { name: "Asha Rao" });
    await page.goto("/account");
    await page.getByRole("main").getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("main").getByRole("link", { name: "Log in", exact: true })).toBeVisible();
  });

  test("tap targets are at least 44px and inputs 16px", async ({ page }) => {
    await signUpAndConfirm(page, { name: "Asha Rao" });
    await page.goto("/account");
    for (const control of [
      page.getByLabel("Name", { exact: true }),
      page.getByRole("button", { name: "Save" }),
      page.getByRole("main").getByRole("button", { name: "Log out" }),
    ]) {
      // The page streams in after its first paint, so wait for each control before measuring it.
      await expect(control).toBeVisible();
      expect((await control.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    const fontSize = await page.getByLabel("Name", { exact: true }).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(fontSize).toBeGreaterThanOrEqual(16);
  });
});

test.describe("phone header", () => {
  test("the header buttons are at least 44px", async ({ page }, info) => {
    await signUpAndConfirm(page, { name: "Asha Rao" });
    const buttons = [page.getByRole("button", { name: "Toggle theme" }), menuButton(page, "Asha Rao")];
    if (isPhone(info.project.name)) buttons.push(page.getByRole("button", { name: "Open group list" }));
    for (const button of buttons) {
      await expect(button).toBeVisible();
      const box = await button.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    }
  });

  // The schema allows up to 50 characters (code points); these are the awkward shapes.
  const NAMES = [
    { label: "50 unbroken Latin characters", name: "W".repeat(50) },
    { label: "a Devanagari name", name: "राम राम राम राम राम राम राम राम राम" },
    { label: "an emoji name", name: "Ana 🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂" },
  ];

  for (const { label, name } of NAMES) {
    test(`${label}: the menu button truncates inside the header, with no sideways scroll`, async ({ page }, info) => {
      await signUpAndConfirm(page, { name, email: uniqueEmail("long") });

      const header = page.getByRole("banner");
      const button = menuButton(page, name);
      await expect(button).toBeVisible();

      const headerBox = await header.boundingBox();
      const buttonBox = await button.boundingBox();
      const viewport = page.viewportSize();
      expect(buttonBox!.x + buttonBox!.width).toBeLessThanOrEqual(headerBox!.x + headerBox!.width);
      expect(buttonBox!.x).toBeGreaterThanOrEqual(0);
      expect(buttonBox!.x + buttonBox!.width).toBeLessThanOrEqual(viewport!.width);
      expect(buttonBox!.height).toBeGreaterThanOrEqual(44);

      const text = page.locator('[data-slot="account-name"]');
      const sizes = await text.evaluate((el) => ({
        scroll: el.scrollWidth,
        client: el.clientWidth,
        overflow: getComputedStyle(el).overflow,
        textOverflow: getComputedStyle(el).textOverflow,
        buttonScroll: el.closest("button")!.scrollWidth,
        buttonClient: el.closest("button")!.clientWidth,
      }));
      expect(sizes.overflow).toBe("hidden");
      expect(sizes.textOverflow).toBe("ellipsis");
      // The text is cut off inside its own element; the button itself never overflows.
      expect(sizes.buttonScroll).toBeLessThanOrEqual(sizes.buttonClient);
      if (isPhone(info.project.name)) expect(sizes.scroll).toBeGreaterThan(sizes.client);

      expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);

      // The menu itself stays inside the screen too, and shows the whole name wrapped or cut, never wider than the screen.
      await button.click();
      await expect(page.getByRole("menu")).toBeVisible();
      const menuBox = await page.getByRole("menu").boundingBox();
      expect(menuBox!.x).toBeGreaterThanOrEqual(0);
      expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(viewport!.width);
      expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);

      await page.goto("/account");
      expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
    });
  }
});

test.describe("themes", () => {
  for (const theme of ["light", "dark"]) {
    test(`the signed-out home and the account page load in the ${theme} theme without console errors`, async ({ page }) => {
      const errors: string[] = [];
      page.on("console", (m) => {
        if (m.type() === "error") errors.push(m.text());
      });
      await page.addInitScript((value) => localStorage.setItem("theme", value), theme);

      await page.goto("/");
      await expect(page.locator("html")).toHaveClass(theme === "dark" ? /dark/ : /^(?!.*dark)/);
      await expect(page.getByRole("main").getByRole("link", { name: "Sign up", exact: true })).toBeVisible();

      await signUpAndConfirm(page, { name: "Asha Rao" });
      await page.goto("/account");
      await expect(page.getByRole("heading", { name: "Account", level: 1 })).toBeVisible();
      expect(errors).toEqual([]);
    });
  }
});

test.describe("web app manifest", () => {
  test("is public JSON that makes the app installable, with 192 and 512 PNG icons", async ({ request }) => {
    const response = await request.get("/manifest.webmanifest", { maxRedirects: 0 });
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("json");
    const manifest = (await response.json()) as {
      name: string;
      short_name: string;
      start_url: string;
      display: string;
      theme_color: string;
      background_color: string;
      icons: { src: string; sizes: string; type: string }[];
    };

    expect(manifest.name).toBe("study-share");
    expect(manifest.short_name).toBe("study-share");
    expect(manifest.start_url).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(manifest.icons.map((icon) => icon.sizes).sort()).toEqual(["192x192", "512x512"]);

    for (const icon of manifest.icons) {
      const image = await request.get(icon.src, { maxRedirects: 0 });
      expect(image.status(), icon.src).toBe(200);
      expect(image.headers()["content-type"], icon.src).toBe("image/png");
      expect(icon.type).toBe("image/png");
      // Public and cacheable by browsers and CDNs.
      const cacheControl = image.headers()["cache-control"] ?? "";
      expect(cacheControl, icon.src).toContain("public");
      expect(cacheControl, icon.src).toMatch(/max-age=\d{4,}/);
      expect(cacheControl, icon.src).not.toContain("no-store");

      // A PNG starts with an 8-byte signature, then the IHDR chunk: width and height are
      // the two big-endian 32-bit numbers at bytes 16 and 20.
      const bytes = await image.body();
      expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
      const [width, height] = icon.sizes.split("x").map(Number);
      expect(bytes.readUInt32BE(16), icon.src).toBe(width);
      expect(bytes.readUInt32BE(20), icon.src).toBe(height);
    }
  });

  test("the page links the manifest", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");
  });
});
