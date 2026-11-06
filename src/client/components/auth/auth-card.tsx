import type { ReactNode } from "react";
import { Skeleton } from "@/client/components/ui/skeleton";

type AuthCardProps = {
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
};

/** One single-column card per screen. On phones it sits flat on the paper; from `sm` up it is a card. */
export function AuthCard({ title, description, children, footer }: AuthCardProps) {
  return (
    <section className="w-full max-w-sm sm:rounded-xl sm:border sm:bg-card sm:p-8 sm:shadow-sm">
      <h1 className="text-3xl leading-tight font-semibold">{title}</h1>
      {description ? <div className="mt-2 text-muted-foreground">{description}</div> : null}
      {children ? <div className="mt-7">{children}</div> : null}
      {footer ? <div className="mt-8 border-t pt-6 text-sm text-muted-foreground">{footer}</div> : null}
    </section>
  );
}

/** Shown while a screen waits for the request (cookies, address, browser). */
export function AuthCardSkeleton({ fields = 2 }: { fields?: number }) {
  return (
    <section
      aria-busy="true"
      aria-label="Loading"
      className="w-full max-w-sm sm:rounded-xl sm:border sm:bg-card sm:p-8 sm:shadow-sm"
    >
      {/* This part of the page arrives by streaming, which needs JavaScript. */}
      <noscript>
        <p className="mb-4 rounded-lg border bg-muted p-3 text-sm">
          This page needs JavaScript. Please turn it on in your browser settings, then reload.
        </p>
      </noscript>
      <Skeleton className="h-9 w-3/4" />
      <Skeleton className="mt-3 h-5 w-full" />
      <div className="mt-7 flex flex-col gap-5">
        {Array.from({ length: fields }, (_, i) => (
          <div key={i} className="flex flex-col gap-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-11 w-full" />
          </div>
        ))}
        <Skeleton className="h-11 w-full" />
      </div>
    </section>
  );
}
