import { headers } from "next/headers";
import { isInAppBrowser } from "@/shared/in-app-browser";
import { safeNextPath } from "@/shared/safe-next-path";

type SearchParams = Record<string, string | string[] | undefined>;

/** The first value of a query parameter, or "". */
export function param(params: SearchParams, name: string): string {
  const value = params[name];
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/** The safe return-to path from `?next=`. */
export function nextFrom(params: SearchParams): string {
  return safeNextPath(param(params, "next"));
}

/** `path`, carrying `next` along unless it is the home page. */
export function withNext(path: string, next: string): string {
  return next === "/" ? path : `${path}?next=${encodeURIComponent(next)}`;
}

/** True inside apps like Instagram, where Google sign-in is refused. */
export async function inAppBrowser(): Promise<boolean> {
  return isInAppBrowser((await headers()).get("user-agent") ?? "");
}
