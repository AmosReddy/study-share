const UNITS = ["B", "KB", "MB", "GB"] as const;

/**
 * A file size as people read it: "812 B", "2.4 KB", "2.4 MB", "25 MB". One decimal below 10, none
 * from 10 up. 1024 bytes make a KB (the same unit as the 25 MB limit). Never negative or "NaN".
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  let value = bytes;
  let unit = 0;
  while (unit < UNITS.length - 1 && Math.round(value * 10) / 10 >= 1024) {
    value /= 1024;
    unit += 1;
  }
  if (unit === 0) return `${Math.round(value)} B`;
  const rounded = value < 10 ? Math.round(value * 10) / 10 : Math.round(value);
  return `${rounded} ${UNITS[unit]}`;
}

const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/**
 * A date from an ISO 8601 string, like "14 Nov 2026". It uses UTC and a fixed locale, so the server
 * and the browser always print the same text (no hydration mismatch) and it never reads the clock.
 * An unreadable string gives "".
 */
export function formatFileDate(iso: string): string {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? "" : DATE_FORMAT.format(time);
}
