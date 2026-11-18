/*
  Well-formed text without relying on String.prototype.isWellFormed / toWellFormed, which older
  browsers (Firefox before 119, Safari before 16.4) lack. Shared code runs in the browser too, so it
  uses these. A "lone surrogate" is half of an emoji-style pair; Postgres JSON and encodeURIComponent
  refuse it.
*/
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const LONE_SURROGATES = new RegExp(LONE_SURROGATE.source, "g");

export function isWellFormedText(text: string): boolean {
  const native = (text as { isWellFormed?: () => boolean }).isWellFormed;
  return typeof native === "function" ? native.call(text) : !LONE_SURROGATE.test(text);
}

/** The text with each lone surrogate replaced by U+FFFD, as String.prototype.toWellFormed does. */
export function toWellFormedText(text: string): string {
  const native = (text as { toWellFormed?: () => string }).toWellFormed;
  return typeof native === "function" ? native.call(text) : text.replace(LONE_SURROGATES, "\uFFFD");
}
