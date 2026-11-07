import type { EmailLink } from "./email-link";

/*
  The small page an email link opens: one heading, one line and one large Continue button that
  POSTs the link's parameters back to /auth/confirm. Plain HTML: no JavaScript, no outside
  requests, phone-first, light and dark. The token travels only in a hidden form field.
  Colours are the app's paper-and-ink palette (src/app/globals.css).
*/

const COPY = {
  email: { title: "Confirm your email", line: "Tap Continue to confirm your email address and finish signing up." },
  recovery: { title: "Choose a new password", line: "Tap Continue to choose a new password for your account." },
} as const;

/** Never cached or stored, no referrer, and nothing may load: only the inline style and our own form. */
export const CONFIRM_PAGE_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex",
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
} as const;

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => ESCAPES[c]);

const hidden = (name: string, value: string) => `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`;

const STYLE = `
:root { color-scheme: light dark; --bg: #f7f8f5; --fg: #1b2440; --muted: #565f73; --card: #ffffff; --border: #d9ddd5; --btn: #1b2440; --btn-fg: #f7f8f5; --ring: #3b4f8f; }
@media (prefers-color-scheme: dark) {
  :root { --bg: #0f1526; --fg: #ecf0f8; --muted: #a6aec4; --card: #161d33; --border: #2a3354; --btn: #ecf0f8; --btn-fg: #0f1526; --ring: #8fa2e0; }
}
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; background: var(--bg); color: var(--fg); font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { width: 100%; max-width: 24rem; margin: 0 auto; padding: 48px 16px; }
.card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 24px 20px; }
h1 { margin: 0 0 8px; font-size: 1.5rem; line-height: 1.25; }
p { margin: 0 0 24px; color: var(--muted); }
button { display: block; width: 100%; min-height: 48px; padding: 12px 16px; border: 0; border-radius: 8px; background: var(--btn); color: var(--btn-fg); font: inherit; font-weight: 600; cursor: pointer; }
button:focus-visible { outline: 3px solid var(--ring); outline-offset: 2px; }
`;

export function renderConfirmPage(link: EmailLink): string {
  const { title, line } = COPY[link.type];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex">
<title>${title} | study-share</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<div class="card">
<h1>${title}</h1>
<p>${line}</p>
<form method="post" action="/auth/confirm">
${hidden("token_hash", link.tokenHash)}
${hidden("type", link.type)}
${hidden("redirect_to", link.next)}
<button type="submit">Continue</button>
</form>
</div>
</main>
</body>
</html>
`;
}
