/**
 * Whether a group tab is the current one. Library owns its own address (/groups/<id>) and the
 * upload and file pages under it (/upload, /files/...), so it stays lit while a file is open or
 * being uploaded. Settings owns its own address and the pages under it (/settings/upload-form). Chat
 * and Members match their own address only. A trailing slash is ignored.
 */
export function isTabActive(pathname: string, groupBase: string, tab: "library" | "chat" | "members" | "settings"): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (tab === "settings") return path === `${groupBase}/settings` || path.startsWith(`${groupBase}/settings/`);
  if (tab !== "library") return path === `${groupBase}/${tab}`;
  return path === groupBase || path === `${groupBase}/upload` || path.startsWith(`${groupBase}/files/`);
}
