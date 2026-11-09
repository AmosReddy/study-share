import Link from "next/link";

const legalLink = "font-medium text-foreground underline underline-offset-4";

/**
 * The sentence under the Google button on /signup and /login (spec 3): pressing the button
 * records the person's acceptance, so it must be read before they press it. The links open in a
 * new tab, like the consent box's, so the page is not lost. Its text is
 * AUTH_MESSAGES.googleConsent word for word (the browser tests compare them).
 */
export function GoogleConsent() {
  return (
    <p className="text-center text-sm text-muted-foreground">
      By continuing you confirm you are 18 or older and accept the{" "}
      <Link href="/terms" target="_blank" className={legalLink}>
        Terms
      </Link>{" "}
      and{" "}
      <Link href="/privacy" target="_blank" className={legalLink}>
        Privacy Notice
      </Link>
    </p>
  );
}
