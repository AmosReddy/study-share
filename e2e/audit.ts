import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
import { sidewaysOverflow } from "./helpers";

/*
  The phone quality bar (design spec section 8), as one reusable check for the page that is
  open right now. It fails the test, with a readable list of what is wrong, when:
   - the document scrolls sideways;
   - a visible button, link or input is under 44px high or wide (a link inside a sentence is
     exempt: it is part of the text, not a separate target);
   - a visible text input has a computed font size under 16px (iOS zooms in below that);
   - a visible control has no accessible name;
   - <html> has no lang;
   - axe-core finds a colour-contrast or label problem, or any critical or serious problem.
  Fix the component, never the audit.
*/

const MIN_TARGET = 44;
const MIN_INPUT_FONT = 16;
/** axe rules that always fail the audit, whatever their impact level. */
const ALWAYS_FAIL = new Set(["color-contrast", "label"]);

type Finding = string;

/** Runs in the browser. Returns one line per problem found. */
function inspectControls({ minTarget, minInputFont }: { minTarget: number; minInputFont: number }): Finding[] {
  const findings: string[] = [];

  const describe = (el: Element) => {
    const text = (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
    const type = el instanceof HTMLInputElement ? `[type=${el.type}]` : "";
    return `<${el.tagName.toLowerCase()}${type}> "${text}"`;
  };

  const isVisible = (el: Element) => {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    // The 1px "screen reader only" and hidden-bubble elements are not targets.
    if (rect.width <= 1 && rect.height <= 1) return false;
    for (let node: Element | null = el; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
      if (node.getAttribute("aria-hidden") === "true" || node.hasAttribute("inert")) return false;
    }
    return true;
  };

  const textOf = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").trim();

  const accessibleName = (el: Element): string => {
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const joined = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id))
        .map((node) => (node ? textOf(node) : ""))
        .join(" ")
        .trim();
      if (joined) return joined;
    }
    const ariaLabel = el.getAttribute("aria-label")?.trim();
    if (ariaLabel) return ariaLabel;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
      const label = Array.from(el.labels ?? [])
        .map(textOf)
        .join(" ")
        .trim();
      if (label) return label;
    }
    if (el instanceof HTMLInputElement && ["submit", "button", "reset"].includes(el.type) && el.value.trim()) return el.value.trim();
    const own = textOf(el);
    if (own) return own;
    const image = el.querySelector("img[alt], svg title");
    if (image) return (image.getAttribute("alt") ?? textOf(image)).trim();
    if (el.getAttribute("role") === "checkbox") {
      // A checkbox button is named by the label that points at it (for= / wrapping).
      const id = el.getAttribute("id");
      const label = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : el.closest("label");
      if (label) return textOf(label);
    }
    return (el.getAttribute("title") ?? "").trim();
  };

  const isInline = (link: Element) => {
    const container = link.closest("p, li, label, h1, h2, h3, h4, h5, h6");
    if (!container) return false;
    const around = textOf(container).replace(textOf(link), "").replace(/[^\p{L}\p{N}]/gu, "");
    return around.length > 0;
  };

  const TEXT_INPUT_TYPES = ["text", "email", "password", "search", "tel", "url", "number", ""];
  const selector = [
    "button",
    "a[href]",
    "input:not([type=hidden])",
    "select",
    "textarea",
    "[role=button]",
    "[role=link]",
    "[role=checkbox]",
    "[role=switch]",
    "[role=tab]",
    "[role=menuitem]",
  ].join(",");

  for (const el of document.querySelectorAll(selector)) {
    if (!isVisible(el)) continue;
    const label = describe(el);

    // A checkbox or radio is tapped through its label too, so the label's box counts.
    let box = el.getBoundingClientRect();
    const isTickBox =
      (el instanceof HTMLInputElement && ["checkbox", "radio"].includes(el.type)) ||
      el.getAttribute("role") === "checkbox";
    if (isTickBox) {
      const id = el.getAttribute("id");
      const tapLabel = (id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null) ?? el.closest("label");
      if (tapLabel) box = tapLabel.getBoundingClientRect();
    }

    if (!(el.tagName === "A" && isInline(el))) {
      if (box.height < minTarget - 0.5 || box.width < minTarget - 0.5) {
        findings.push(`tap target too small: ${label} is ${Math.round(box.width)}x${Math.round(box.height)}px (needs ${minTarget}x${minTarget})`);
      }
    }

    if (!accessibleName(el)) findings.push(`no accessible name: ${label}`);

    const isTextInput =
      el instanceof HTMLTextAreaElement ||
      el instanceof HTMLSelectElement ||
      (el instanceof HTMLInputElement && TEXT_INPUT_TYPES.includes(el.type));
    if (isTextInput) {
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size < minInputFont) findings.push(`text too small in input: ${label} is ${size}px (needs ${minInputFont})`);
    }
  }

  if (!document.documentElement.getAttribute("lang")?.trim()) findings.push("the <html> element has no lang");
  return findings;
}

/**
 * Waits until streamed content has replaced loading skeletons, fonts are in and opening
 * animations (menus and sheets grow from 95%) have ended, so measurements are final.
 * Endless animations (a spinner) are not waited for.
 */
async function settle(page: Page) {
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  await page.evaluate(async () => {
    await document.fonts.ready;
    const finite = document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity);
    await Promise.all(finite.map((animation) => animation.finished.catch(() => undefined)));
  });
}

type AuditOptions = {
  /**
   * axe rules to leave out. Only for a page with a modal layer open (a menu or a sheet): Radix
   * hides the page behind it with aria-hidden while keeping focus trapped inside the layer,
   * which axe reports as aria-hidden-focus although it is the intended behaviour.
   */
  skipAxeRules?: string[];
};

/** Fails the test when the page that is open now misses the phone quality bar. */
export async function auditPage(page: Page, options: AuditOptions = {}): Promise<void> {
  await settle(page);
  const problems: Finding[] = [];

  const overflow = await sidewaysOverflow(page);
  if (overflow > 0) problems.push(`the page scrolls sideways by ${overflow}px`);

  problems.push(...(await page.evaluate(inspectControls, { minTarget: MIN_TARGET, minInputFont: MIN_INPUT_FONT })));

  const axe = await new AxeBuilder({ page }).disableRules(options.skipAxeRules ?? []).analyze();
  for (const violation of axe.violations) {
    const fails = ALWAYS_FAIL.has(violation.id) || violation.impact === "critical" || violation.impact === "serious";
    if (!fails) continue;
    const where = violation.nodes.map((node) => node.target.join(" ")).slice(0, 5).join("; ");
    problems.push(`axe ${violation.id} (${violation.impact}): ${violation.help} at ${where}`);
  }

  expect(problems, `${page.url()} misses the phone quality bar`).toEqual([]);
}
