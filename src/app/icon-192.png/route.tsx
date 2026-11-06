import { appIconResponse } from "../_icon/app-icon";

/** Public and static: built once at build time. */
export function GET() {
  return appIconResponse(192);
}
