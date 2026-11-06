import type { ReactNode } from "react";
import { AuthFrame } from "./auth-frame";

type LegalPageProps = {
  title: string;
  /** The date of this text, matching the terms version people accept. */
  updated: string;
  children: ReactNode;
};

/** A short plain-language document (Terms, Privacy) in the sign-in pages' frame. */
export function LegalPage({ title, updated, children }: LegalPageProps) {
  return (
    <AuthFrame>
      <article className="w-full max-w-prose">
        <h1 className="text-3xl leading-tight font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated {updated}</p>
        <p className="mt-4 rounded-lg border bg-muted p-3 text-sm font-medium">
          <span className="marker px-0.5">Pilot version, to be reviewed before public launch</span>
        </p>
        <div className="mt-8 flex flex-col gap-4 leading-7 [&_h2]:mt-4 [&_h2]:text-xl [&_h2]:font-semibold [&_ul]:flex [&_ul]:list-disc [&_ul]:flex-col [&_ul]:gap-1 [&_ul]:pl-5">
          {children}
        </div>
      </article>
    </AuthFrame>
  );
}

/** The contact address as a mail link, wrapping on narrow screens. */
export function ContactLink({ email }: { email: string }) {
  return (
    <a href={`mailto:${email}`} className="font-medium break-all underline underline-offset-4">
      {email}
    </a>
  );
}
