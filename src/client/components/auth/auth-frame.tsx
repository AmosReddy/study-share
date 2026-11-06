import Link from "next/link";
import type { ReactNode } from "react";
import { ThemeToggle } from "@/client/components/app-shell/theme-toggle";

/** 44px tall tap targets, with a visible focus ring. */
const footerLink =
  "inline-flex min-h-11 items-center rounded-md px-2 underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50";

/** The page around the sign-in screens and the legal pages: brand, theme toggle, and a quiet footer. */
export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-14 items-center gap-2 px-4 sm:px-6">
        <Link
          href="/"
          className="font-heading inline-flex min-h-11 items-center rounded-md text-lg font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <span className="marker px-0.5">study-share</span>
        </Link>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </header>

      <main className="flex flex-1 justify-center px-4 pt-6 pb-10 sm:items-start sm:pt-12">{children}</main>

      <footer className="px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-center sm:px-6">
        <p className="flex items-center justify-center gap-1 text-sm text-muted-foreground">
          <Link href="/terms" className={footerLink}>
            Terms
          </Link>
          <span aria-hidden="true">·</span>
          <Link href="/privacy" className={footerLink}>
            Privacy
          </Link>
        </p>
      </footer>
    </div>
  );
}
