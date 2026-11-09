import type { FullResult, Reporter } from "@playwright/test/reporter";

/*
  Fails the browser run when the app's own server logged that Next.js could not prerender a page:

    Error: Route "/groups/new": Next.js encountered the unstable value `Date.now()` while prerendering

  That happens when code reads the clock or a random value before the request is known, for example
  while Next.js prerenders a page's shell for a link's prefetch. It never shows in a browser test:
  the page still opens (the request then renders normally), but the prefetch fails and, in
  production, pages "sometimes do not load". The webServer's output is piped to the reporters
  (playwright.config.ts: stdout "pipe"), so this reporter sees every line the server printed
  while the tests ran. e2e/prerender.spec.ts opens the pages with their links in view, which is
  what makes the server do those prefetch renders.
*/

/** What Next.js prints for a render that read the clock/random/crypto too early. */
const PRERENDER_ERROR = /unstable value|while prerendering|blocking-prerender/i;

/** The colour codes Next.js puts in its log lines. */
const COLOUR_CODES = new RegExp(`${String.fromCharCode(27)}[[][0-9;]*m`, "g");

export default class ServerLogReporter implements Reporter {
  private output = "";

  onStdOut(chunk: string | Buffer) {
    this.output += chunk.toString();
  }

  onStdErr(chunk: string | Buffer) {
    this.output += chunk.toString();
  }

  async onEnd(): Promise<{ status: FullResult["status"] } | undefined> {
    const lines = this.output.split(/\r?\n/).filter((line) => PRERENDER_ERROR.test(line));
    if (lines.length === 0) return undefined;
    const unique = [...new Set(lines.map((line) => line.replace(COLOUR_CODES, "").trim()))];
    console.error(
      [
        "",
        `The server logged ${lines.length} prerender error(s) while the browser tests ran:`,
        ...unique.slice(0, 10).map((line) => `  ${line}`),
        "",
        "Something read the clock or a random value before the request was known (Date.now(), new Date(),",
        "Math.random(), crypto.randomUUID()). Call `await connection()` (next/server) before it, after",
        "cookies()/headers(); see getCurrentUser in src/server/auth/session.ts.",
        "",
      ].join("\n"),
    );
    return { status: "failed" };
  }
}
