"use client";

import { LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/client/components/ui/button";
import { cn } from "@/client/lib/utils";

type SubmitButtonProps = {
  children: ReactNode;
  /** Shown while the form is sending, for example "Logging in…". */
  pendingLabel: string;
  /** Pending state from `useActionState`, for forms that submit through a transition. */
  pending?: boolean;
  variant?: "default" | "outline" | "destructive";
  /** Disabled for another reason than sending (for example a name still to be typed). */
  disabled?: boolean;
  className?: string;
};

/** Full-width, 44px tall, and disabled while its form is sending. */
export function SubmitButton({ children, pendingLabel, pending = false, variant = "default", disabled = false, className }: SubmitButtonProps) {
  const status = useFormStatus();
  const busy = pending || status.pending;

  return (
    <Button type="submit" variant={variant} disabled={busy || disabled} className={cn("h-11 w-full gap-2 text-base", className)}>
      {busy ? (
        <>
          <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
          {pendingLabel}
        </>
      ) : (
        children
      )}
    </Button>
  );
}
