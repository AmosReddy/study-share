import { describe, expect, it } from "vitest";
import { CONFIRM_PAGE_HEADERS, renderConfirmPage } from "./confirm-page";

const TOKEN = "pkce_0123456789abcdef";

/** The text a person sees: tags, attribute values and the style block removed. */
function visibleText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<title>[\s\S]*?<\/title>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

describe("renderConfirmPage", () => {
  it("asks to confirm the email for a sign-up link", () => {
    const html = renderConfirmPage({ tokenHash: TOKEN, type: "email", next: "/privacy" });
    expect(html).toContain("<h1>Confirm your email</h1>");
    expect(html).toContain("<title>Confirm your email | study-share</title>");
  });

  it("asks to choose a new password for a reset link", () => {
    const html = renderConfirmPage({ tokenHash: TOKEN, type: "recovery", next: "/" });
    expect(html).toContain("<h1>Choose a new password</h1>");
  });

  it("is one form that POSTs the same parameters back, with a single Continue button", () => {
    const html = renderConfirmPage({ tokenHash: TOKEN, type: "email", next: "/groups/1?tab=a" });
    expect(html.match(/<form /g)).toHaveLength(1);
    expect(html).toContain('<form method="post" action="/auth/confirm">');
    expect(html).toContain(`<input type="hidden" name="token_hash" value="${TOKEN}">`);
    expect(html).toContain('<input type="hidden" name="type" value="email">');
    expect(html).toContain('<input type="hidden" name="redirect_to" value="/groups/1?tab=a">');
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toMatch(/<button type="submit">Continue<\/button>/);
  });

  it("carries the token only in a hidden field, never as text", () => {
    const html = renderConfirmPage({ tokenHash: TOKEN, type: "email", next: "/" });
    expect(html.split(TOKEN)).toHaveLength(2);
    expect(visibleText(html)).not.toContain(TOKEN);
  });

  it("escapes every value it puts into the page", () => {
    const html = renderConfirmPage({ tokenHash: '"><script>alert(1)</script>', type: "email", next: '/x?a="&b=<i>' });
    expect(html).not.toContain("<script>");
    expect(html).toContain('value="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"');
    expect(html).toContain('value="/x?a=&quot;&amp;b=&lt;i&gt;"');
  });

  it("needs no JavaScript and loads nothing from anywhere else", () => {
    const html = renderConfirmPage({ tokenHash: TOKEN, type: "recovery", next: "/" });
    expect(html).not.toMatch(/<script|<link|<img|<iframe|@import|url\(/i);
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
    expect(html).toContain('<meta name="referrer" content="no-referrer">');
  });

  it("has a button at least 44px tall and a layout that fits a 360px screen", () => {
    const html = renderConfirmPage({ tokenHash: TOKEN, type: "email", next: "/" });
    expect(html).toMatch(/button\s*\{[^}]*min-height:\s*48px/);
    expect(html).toMatch(/max-width:\s*24rem/);
  });
});

describe("CONFIRM_PAGE_HEADERS", () => {
  it("is never cached, sends no referrer, and allows nothing but its own form and inline style", () => {
    expect(CONFIRM_PAGE_HEADERS["Cache-Control"]).toBe("no-store");
    expect(CONFIRM_PAGE_HEADERS["Referrer-Policy"]).toBe("no-referrer");
    expect(CONFIRM_PAGE_HEADERS["Content-Type"]).toBe("text/html; charset=utf-8");
    expect(CONFIRM_PAGE_HEADERS["Content-Security-Policy"]).toContain("default-src 'none'");
    expect(CONFIRM_PAGE_HEADERS["Content-Security-Policy"]).toContain("form-action 'self'");
  });
});
