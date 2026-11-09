"use client";

import Link from "next/link";
import { linkTarget } from "@/client/components/auth/auth-card";
import { Button } from "@/client/components/ui/button";

/**
 * What a page shows when it fails to load (the database is down, say): a plain sentence, a way to
 * try again and a way home. It never prints the error: the details are in the server log.
 * `retry` fetches the page again, which is what a person wants after an outage.
 */
export default function Error({ retry }: { error: unknown; retry: () => void }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4 text-center">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p role="alert" className="text-muted-foreground">
        Something went wrong. Please try again.
      </p>
      <div className="flex flex-col items-center gap-2">
        <Button type="button" className="h-11 px-6 text-base" onClick={() => retry()}>
          Try again
        </Button>
        <Link href="/" className={linkTarget}>
          Go to the home page
        </Link>
      </div>
    </main>
  );
}
