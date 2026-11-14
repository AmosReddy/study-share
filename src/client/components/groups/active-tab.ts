/**
 * Whether a group tab is the current one. Library owns its own address (/groups/<id>) and the
 * upload and file pages under it (/upload, /files/...), so it stays lit while a file is open or
 * being uploaded. Chat, Members and Settings match their own address only. A trailing slash is ignored.
 */
export function isTabActive(pathname: string, groupBase: string, tab: "library" | "chat" | "members" | "settings"): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (tab !== "library") return path === `${groupBase}/${tab}`;
  return path === groupBase || path === `${groupBase}/upload` || path.startsWith(`${groupBase}/files/`);
}
