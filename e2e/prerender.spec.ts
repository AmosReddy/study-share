import { expect, test, type Page, type Request } from "@playwright/test";
import { createGroupThroughForm, isolateRateLimits, signUpAndConfirm } from "./helpers";

/*
  Next.js prerenders a page's shell for the build and for a link's prefetch, and it refuses code
  that reads the clock or a random value before the request is known: the server logs
  `Route "/groups/new": Next.js encountered the unstable value Date.now() while prerendering`,
  the prefetch fails, and pages "sometimes do not load". Nothing in the browser shows that, so
  this spec opens every signed-in and signed-out page with its links in view (which is what makes
  the router prefetch them) and the server's log is checked at the end of the whole run by
  e2e/server-log-reporter.ts.

  It also checks that the prefetches really happened, so that check cannot pass because nothing
  was prefetched.
*/

/** Records Next.js's own prefetch requests (the router marks them with a header). */
function watchPrefetches(page: Page): () => string[] {
  const paths: string[] = [];
  page.on("request", (request: Request) => {
    const headers = request.headers();
    if (headers["next-router-prefetch"] || headers["next-router-segment-prefetch"]) {
      paths.push(new URL(request.url()).pathname);
    }
  });
  return () => paths;
}

/**
 * Scrolls every visible link into view, so the router prefetches each of them, and gives the
 * requests time to reach the server (they are cancelled when the page is left, and the server
 * logs the error when it renders, not when the response ends).
 */
async function bringLinksIntoView(page: Page) {
  const links = page.locator("a[href^='/']:visible");
  const count = await links.count();
  for (let i = 0; i < count; i++) await links.nth(i).scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(1000);
}

test("signed-in pages and the invite page prerender and prefetch without reading the clock early", async ({ page, browser }) => {
  test.slow();
  await isolateRateLimits(page);
  const prefetched = watchPrefetches(page);
  await signUpAndConfirm(page, { name: "Asha Rao" });
  await bringLinksIntoView(page);

  const group = await createGroupThroughForm(page, { name: "Prerender check", mode: "link", fromHome: true });
  for (const path of ["/", "/account", "/join", "/groups/new", group.path, `${group.path}/upload`, `${group.path}/members`, `${group.path}/settings`]) {
    await page.goto(path);
    await expect(page.getByRole("main")).toBeVisible();
    await bringLinksIntoView(page);
  }
  // The invite as a member (the page sends a member on to the group).
  await page.goto(group.invitePath);
  await expect(page).toHaveURL(group.path);
  await bringLinksIntoView(page);

  // The invite and the other pages as a signed-out visitor.
  const visitor = await browser.newContext({ baseURL: new URL(page.url()).origin });
  const signedOut = await visitor.newPage();
  await isolateRateLimits(signedOut);
  const visitorPrefetched = watchPrefetches(signedOut);
  for (const path of [group.invitePath, "/", "/login", "/signup", "/forgot-password"]) {
    await signedOut.goto(path);
    await expect(signedOut.locator("body")).toBeVisible();
    await bringLinksIntoView(signedOut);
  }
  await visitor.close();

  // The sidebar and the home page link to Create a group and Join, so they were prefetched.
  expect(prefetched()).toEqual(expect.arrayContaining(["/groups/new", "/join"]));
  expect(visitorPrefetched().length).toBeGreaterThan(0);
});
