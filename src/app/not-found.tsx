import Link from "next/link";
import { linkTarget } from "@/client/components/auth/auth-card";

/**
 * The page for an address that leads nowhere, and for a group the person may not see (the two look
 * alike on purpose). The sentence is the one the default page used, which the tests look for.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-muted-foreground">This page could not be found.</p>
      <Link href="/" className={linkTarget}>
        Go to the home page
      </Link>
    </main>
  );
}
