import type { RefObject } from "react";

/**
 * A form's live region for field errors that focus cannot announce (see useAuthForm). Empty
 * and invisible until useAuthForm fills it; place it inside the form.
 */
export function ErrorAnnouncer({ announcerRef }: { announcerRef: RefObject<HTMLParagraphElement | null> }) {
  return <p ref={announcerRef} role="alert" className="sr-only" />;
}
