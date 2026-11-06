"use client";

import { ChevronDown, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { startTransition, useState } from "react";
import { IDLE, type FormAction } from "@/shared/form-state";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";

type AccountMenuProps = {
  name: string;
  email: string;
  /** A server action that signs the person out and redirects to `/`, or returns the reason it could not. */
  logOutAction: FormAction;
};

const itemClass = "min-h-11 px-3 text-base";

/**
 * The person's name in the shell header, opening Account and Log out. The name is cut off with
 * an ellipsis inside its own element, so a very long one never widens the header; the button
 * is always at least 44px tall.
 */
export function AccountMenu({ name, email, logOutAction }: AccountMenuProps) {
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <DropdownMenu onOpenChange={() => setError(null)}>
      <div className="max-w-32 min-w-0 sm:max-w-56">
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex min-h-11 w-full min-w-0 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 aria-expanded:bg-muted"
          >
            <span data-slot="account-name" className="block min-w-0 truncate">
              {name}
            </span>
            <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
      </div>

      <DropdownMenuContent align="end" className="w-64 max-w-[calc(100vw-1.5rem)]">
        <DropdownMenuLabel className="flex flex-col gap-0.5 px-3 py-2 font-normal">
          <span className="truncate text-sm font-medium text-foreground">{name}</span>
          <span className="truncate text-sm text-muted-foreground">{email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className={itemClass}>
          <Link href="/account">Account</Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          className={itemClass}
          disabled={loggingOut}
          onSelect={(event) => {
            // Keep the menu mounted until the redirect, so the request is not cut short.
            event.preventDefault();
            setLoggingOut(true);
            setError(null);
            startTransition(async () => {
              try {
                const result = await logOutAction(IDLE, new FormData());
                // On success the action redirects; only a failure comes back here.
                if (result.formError) setError(result.formError);
              } finally {
                setLoggingOut(false);
              }
            });
          }}
        >
          {loggingOut ? (
            <>
              <LoaderCircle className="animate-spin" aria-hidden="true" />
              Logging out…
            </>
          ) : (
            "Log out"
          )}
        </DropdownMenuItem>
        {error ? (
          <p role="alert" className="px-3 py-2 text-sm font-medium text-destructive">
            {error}
          </p>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
