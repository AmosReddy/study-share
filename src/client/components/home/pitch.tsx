import Link from "next/link";
import { AuthFrame } from "@/client/components/auth/auth-frame";
import { buttonVariants } from "@/client/components/ui/button";
import { cn } from "@/client/lib/utils";

const cta = "h-11 flex-1 px-5 text-base sm:flex-none";

/** `/` for a signed-out visitor: what the app is for, and the two ways in. Same frame and look as the auth pages. */
export function Pitch() {
  return (
    <AuthFrame>
      <section className="flex w-full max-w-md flex-col gap-6 sm:pt-8">
        <h1 className="text-4xl leading-tight font-semibold">
          Your class&apos;s notes, in one place, not lost in <span className="marker px-0.5">WhatsApp</span>.
        </h1>
        <p className="text-lg text-muted-foreground">
          Share notes, previous year papers and study material with your class, sorted by subject, semester and type, and
          easy to find when exams are close.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/signup" className={cn(buttonVariants({ variant: "default" }), cta)}>
            Sign up
          </Link>
          <Link href="/login" className={cn(buttonVariants({ variant: "outline" }), cta)}>
            Log in
          </Link>
        </div>
      </section>
    </AuthFrame>
  );
}
